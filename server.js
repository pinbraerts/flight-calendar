import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const PORT = 3000;
const ROOT = import.meta.dir;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.json': 'application/json',
  '.pdf':  'application/pdf',
  '.css':  'text/css',
};

function mime(path) {
  const ext = path.match(/\.[^.]+$/)?.[0] ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url      = new URL(req.url);
    let   pathname = url.pathname === '/' ? '/web/index.html' : url.pathname;
    const filePath = join(ROOT, pathname);

    try {
      const body = await readFile(filePath);
      return new Response(body, {
        headers: { 'Content-Type': mime(pathname) },
      });
    } catch {
      return new Response('404 Not Found', { status: 404 });
    }
  },
});

console.log(`Serving at http://localhost:${PORT}`);
