// Offline render helper for the streak flame loops (NOT part of the site).
// Serves tools/flame/render.html and stores the PNG frames the page POSTs,
// so ffmpeg can turn them into the looping video under assets/flame/.
//   node tools/flame/render-server.cjs <outDir> [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || path.join(__dirname, 'out');
const port = Number(process.argv[3] || 8091);
fs.mkdirSync(outDir, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.mp4': 'video/mp4', '.webp': 'image/webp', '.glsl': 'text/plain; charset=utf-8' };

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/frame') {
      const set = (url.searchParams.get('set') || 'f').replace(/[^a-z0-9_-]/gi, '');
      const i = String(Number(url.searchParams.get('i') || 0)).padStart(4, '0');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = path.join(outDir, set);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `f_${i}.png`), Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/render.html';
    // /out/... serves rendered results (frames, videos); everything else is tools/flame/.
    const base = rel.startsWith('/out/') ? outDir : __dirname;
    const file = path.normalize(path.join(base, rel.startsWith('/out/') ? rel.slice(4) : rel));
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`flame render server on http://localhost:${port}/  ->  ${outDir}`));
