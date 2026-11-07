# BitChord Archive Streaming Addon

A small BitChord-compatible HTTP addon that searches publicly available audio at Internet Archive and resolves direct audio streams. No packages or API keys required.

## Run

Requires Node.js 20 or newer.

```bash
npm start
```

By default listens on port 8787; set `PORT` to change it.

## Install in BitChord

Deploy this Node.js service on a host with a public HTTPS URL (for example Render or Railway). Start command: `npm start`. Then in BitChord, go to **Settings → Sources → Add an addon** and paste `https://YOUR-HOST/manifest.json`.

## Routes

- `GET /manifest.json`: BitChord manifest with `allowDownloads: 0`
- `GET /search?q=...`: Search the Internet Archive audio catalogue
- `GET /stream/{id}`: Return a playable audio URL
- `GET /health`: Health check

## Notes

This is streaming-only **within BitChord**. `allowDownloads: 0` prevents BitChord from using this addon as its offline download source; it is not DRM and cannot prevent someone from fetching a public audio URL independently.

Internet Archive content varies in quality, licensing, metadata and availability. Stream only material you are entitled to use. This addon does not bypass DRM or paid subscriptions.

This starter does not implement optional BitChord app attestation (`bitchordAuth`), so newer versions may show an **Outdated addon** warning. For production use, follow https://bitchord.kushagrasingh.in/docs and add the official verifier, configuring your deployed host name. Live playback in the Android app has not been verified.
