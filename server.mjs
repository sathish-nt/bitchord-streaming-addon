
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const ARCHIVE = 'https://archive.org';

const manifest = {
  id: 'org.community.archive-stream-only',
  name: 'Archive Audio — Streaming Only',
  version: '1.1.0',
  description: 'Internet Archive MP3 streaming',
  resources: ['search', 'stream'],
  allowDownloads: 0,
  checkValidLossless: 0
};

const metadataCache = new Map();
const availabilityCache = new Map();

function respond(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
}

async function getJSON(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function playable(file) {
  return typeof file?.name === 'string' &&
    /\.mp3$/i.test(file.name) &&
    file.private !== 'true' &&
    file.source !== 'metadata' &&
    !/(_spectrogram|_thumb|_meta|_files)\./i.test(file.name);
}

function mediaUrl(identifier, filename) {
  return `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${filename.split('/').map(encodeURIComponent).join('/')}`;
}

function stableId(identifier, filename) {
  return Buffer.from(
    JSON.stringify([identifier, filename])
  ).toString('base64url');
}

function decodeId(id) {
  let pair;
  try {
    pair = JSON.parse(
      Buffer.from(id, 'base64url').toString('utf8')
    );
  } catch {
    throw new Error('Invalid id');
  }

  if (!Array.isArray(pair) || pair.length !== 2 ||
      pair.some(v => typeof v !== 'string') ||
      !pair[0] || !pair[1] ||
      pair[0].length > 200 || pair[1].length > 500) {
    throw new Error('Invalid id');
  }
  return pair;
}

async function details(identifier) {
  const saved = metadataCache.get(identifier);
  if (saved && saved.expires > Date.now()) {
    return saved.data;
  }

  const data = await getJSON(
    `${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`
  );

  metadataCache.set(identifier, {
    data,
    expires: Date.now() + 300000
  });

  if (metadataCache.size > 150) {
    metadataCache.delete(metadataCache.keys().next().value);
  }
  return data;
}

function first(value) {
  return Array.isArray(value) ? value[0] : (value || '');
}

// Check audio availability without downloading the full file.
async function verifiedAudioUrl(identifier, filename) {
  const key = stableId(identifier, filename);
  const saved = availabilityCache.get(key);

  if (saved && saved.expires > Date.now()) {
    return saved.url;
  }

  const candidate = mediaUrl(identifier, filename);
  let response;

  try {
    response = await fetch(candidate, {
      method: 'GET',
      headers: { Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });

    const type = (
      response.headers.get('content-type') || ''
    ).toLowerCase();

    const length = Number(
      response.headers.get('content-length') || 0
    );

    const valid =
      (response.status === 200 || response.status === 206) &&
      !type.includes('text/html') &&
      !type.includes('application/json') &&
      (response.status === 206 || length === 0 || length > 1024);

    await response.body?.cancel();

    const audioUrl = valid ? candidate : null;

    availabilityCache.set(key, {
      url: audioUrl,
      expires: Date.now() + (valid ? 300000 : 60000)
    });

    if (availabilityCache.size > 500) {
      availabilityCache.delete(
        availabilityCache.keys().next().value
      );
    }

    return audioUrl;
  } catch {
    try {
      await response?.body?.cancel();
    } catch {}
    return null;
  }
}

async function search(query) {
  const terms = query
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

  if (!terms.length) return [];

  const params = new URLSearchParams();
  const expression = terms.join(' OR ');

  params.set(
    'q',
    `mediatype:audio AND (title:(${expression}) OR creator:(${expression}))`
  );
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'creator');
  params.set('rows', '8');
  params.set('output', 'json');

  const results = await getJSON(
    `${ARCHIVE}/advancedsearch.php?${params}`
  );

  const docs = results.response?.docs || [];

  const groups = await Promise.allSettled(
    docs.map(async doc => {
      const data = await details(doc.identifier);

      if (data.is_dark === true ||
          data.is_dark === 'true') {
        return [];
      }

      const files = (data.files || [])
        .filter(playable)
        .slice(0, 2);

      return Promise.all(files.map(async file => {
        const audioUrl = await verifiedAudioUrl(
          doc.identifier, file.name
        );

        if (!audioUrl) return null;

        return {
          id: stableId(doc.identifier, file.name),
          title: first(file.title) ||
            file.name.replace(/\.[^.]+$/, '')
              .replace(/[_-]/g, ' '),
          artist: first(file.artist) ||
            first(data.metadata?.creator) ||
            first(doc.creator) ||
            'Unknown artist',
          album: first(data.metadata?.title) ||
            first(doc.title) || '',
          artworkURL:
            `${ARCHIVE}/services/img/${encodeURIComponent(doc.identifier)}`,
          format: 'mp3',
          audioQuality: 'HIGH'
        };
      }));
    })
  );

  return groups
    .filter(g => g.status === 'fulfilled')
    .flatMap(g => g.value)
    .filter(Boolean)
    .slice(0, 16);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') {
    return respond(res, 405, {
      error: 'Method not allowed'
    });
  }

  let url;
  try {
    url = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );
  } catch {
    return respond(res, 400, {
      error: 'Invalid URL'
    });
  }

  if (url.pathname === '/' ||
      url.pathname === '/manifest.json') {
    return respond(res, 200, manifest);
  }

  if (url.pathname === '/health') {
    return respond(res, 200, { ok: true });
  }

  try {
    if (url.pathname === '/search') {
      const q = (
        url.searchParams.get('q') || ''
      ).trim().slice(0, 100);

      return respond(res, 200, {
        tracks: q ? await search(q) : []
      });
    }

    if (url.pathname.startsWith('/stream/')) {
      const id = decodeURIComponent(
        url.pathname.slice('/stream/'.length)
      );

      const [identifier, filename] = decodeId(id);
      const data = await details(identifier);

      const file = (data.files || []).find(
        f => f.name === filename && playable(f)
      );

      if (!file ||
          data.is_dark === true ||
          data.is_dark === 'true') {
        return respond(res, 404, {
          error: 'Track unavailable'
        });
      }

      const audioUrl = await verifiedAudioUrl(
        identifier, filename
      );

      if (!audioUrl) {
        return respond(res, 404, {
          error: 'Audio file unavailable'
        });
      }

      return respond(res, 200, {
        url: audioUrl,
        format: 'mp3',
        quality: 'Standard',
        codec: 'mp3',
        container: 'mp3',
        manifest: 'none',
        encrypted: false
      });
    }

    return respond(res, 404, {
      error: 'Not found'
    });

  } catch (error) {
    if (error.message === 'Invalid id' ||
        error instanceof URIError) {
      return respond(res, 404, {
        error: 'Track not found'
      });
    }

    console.error(error);
    return respond(res, 502, {
      error: 'Audio catalogue temporarily unavailable'
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BitChord addon running on port ${PORT}`);
});
