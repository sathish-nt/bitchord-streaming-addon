import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const ARCHIVE = 'https://archive.org';
const manifest = {
  id: 'org.community.archive-stream-only',
  name: 'Archive Audio — Streaming Only',
  version: '1.0.0',
  description: 'Streams publicly available Internet Archive audio. No offline downloads.',
  resources: ['search', 'stream'],
  allowDownloads: 0,
  checkValidLossless: 0
};

const cache = new Map();
function respond(res, status, body) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'access-control-allow-origin':'*'});
  res.end(JSON.stringify(body));
}
async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {signal: controller.signal, headers: {'user-agent':'BitChordArchiveStreamAddon/1.0 (public audio search)'}});
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
function playable(file) {
  const name = file.name || '';
  if (!/\.(mp3|m4a|ogg|flac)$/i.test(name)) return false;
  if (/(_spectrogram|_thumb|_meta|_files)\./i.test(name)) return false;
  return true;
}
function formatOf(name) { return name.split('.').pop().toLowerCase(); }
function mediaUrl(identifier, name) {
  return `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${name.split('/').map(encodeURIComponent).join('/')}`;
}
function stableId(identifier, name) {
  return Buffer.from(JSON.stringify([identifier, name])).toString('base64url');
}
function decodeId(id) {
  const pair = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  if (!Array.isArray(pair) || pair.length !== 2 || pair.some(v => typeof v !== 'string') || pair[0].length > 200 || pair[1].length > 500) throw new Error('Invalid id');
  return pair;
}
async function details(identifier) {
  const saved = cache.get(identifier);
  if (saved && saved.expires > Date.now()) return saved.data;
  const data = await getJSON(`${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`);
  cache.set(identifier, {data, expires: Date.now() + 5 * 60_000});
  if (cache.size > 150) cache.delete(cache.keys().next().value);
  return data;
}
function first(value) { return Array.isArray(value) ? value[0] : (value || ''); }
async function search(query) {
  const params = new URLSearchParams();
  params.set('q', `mediatype:audio AND (title:(${query.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0,8).join(' OR ')}) OR creator:(${query.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0,8).join(' OR ')}))`);
  params.set('fl[]', 'identifier'); params.append('fl[]', 'title'); params.append('fl[]', 'creator');
  params.set('rows', '8'); params.set('page', '1'); params.set('output', 'json');
  const results = await getJSON(`${ARCHIVE}/advancedsearch.php?${params}`);
  const docs = results.response?.docs || [];
  const groups = await Promise.allSettled(docs.map(async doc => {
    const data = await details(doc.identifier);
    const files = (data.files || []).filter(playable).slice(0, 5);
    return files.map(file => {
      const format = formatOf(file.name);
      return {
        id: stableId(doc.identifier, file.name),
        title: file.title || file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '),
        artist: first(file.artist) || first(data.metadata?.creator) || first(doc.creator) || 'Unknown artist',
        album: first(data.metadata?.title) || first(doc.title) || '',
        artworkURL: `${ARCHIVE}/services/img/${encodeURIComponent(doc.identifier)}`,
        format,
        audioQuality: format === 'flac' ? 'LOSSLESS' : 'HIGH'
      };
    });
  }));
  return groups.filter(g => g.status === 'fulfilled').flatMap(g => g.value).slice(0, 25);
}
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') return respond(res, 405, {error:'Method not allowed'});
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return respond(res, 400, {error:'Invalid URL'}); }
  if (url.pathname === '/' || url.pathname === '/manifest.json') return respond(res, 200, manifest);
  if (url.pathname === '/health') return respond(res, 200, {ok:true});
  try {
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return respond(res, 200, {tracks:[]});
      return respond(res, 200, {tracks: await search(q)});
    }
    if (url.pathname.startsWith('/stream/')) {
      const [identifier, filename] = decodeId(decodeURIComponent(url.pathname.slice('/stream/'.length)));
      const data = await details(identifier);
      const file = (data.files || []).find(f => f.name === filename && playable(f));
      if (!file) return respond(res, 404, {error:'Track not found'});
      const format = formatOf(filename);
      return respond(res, 200, {
        url: mediaUrl(identifier, filename),
        format, quality: format === 'flac' ? 'Lossless' : 'Standard',
        codec: format === 'm4a' ? 'aac' : format,
        container: format === 'm4a' ? 'mp4' : format,
        manifest: 'none', encrypted: false
      });
    }
    return respond(res, 404, {error:'Not found'});
  } catch (error) {
    if (error.message === 'Invalid id' || error instanceof SyntaxError) return respond(res, 404, {error:'Track not found'});
    console.error(error);
    return respond(res, 502, {error:'Audio catalogue temporarily unavailable'});
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`BitChord streaming addon on port ${PORT}`));
