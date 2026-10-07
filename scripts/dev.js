// @ts-check
// Local development server: serves public/ like Vercel does and sends /api/* to the same handler.
// Usage: npm run dev   (then open http://localhost:3100)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(); } catch { /* no .env */ }
const { default: api } = await import('../api/index.js');

const ROOT = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const PORT = Number(process.env.PORT ?? 3100);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

/** Clean URLs like Vercel's: /shop serves shop.html, /admin serves admin/index.html. */
function resolveFile(/** @type {string} */ pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const base = join(ROOT, safe);
  if (!base.startsWith(ROOT)) return null;
  for (const candidate of [base, `${base}.html`, join(base, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    void api(req, res);
    return;
  }
  const file = resolveFile(url.pathname) ?? join(ROOT, '404.html');
  res.statusCode = file.endsWith('404.html') && url.pathname !== '/404' ? 404 : 200;
  res.setHeader('Content-Type', TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Halden Outfitters: http://localhost:${PORT}`));
