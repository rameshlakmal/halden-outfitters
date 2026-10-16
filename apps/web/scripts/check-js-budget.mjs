// Fails when a storefront page's first-load JavaScript (the scripts its HTML asks for, gzipped) is over
// budget. Deterministic, unlike lab timings. Usage: node scripts/check-js-budget.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BASE = process.argv[2] ?? 'http://localhost:3001';
const BUDGETS = [
  // Storefront: framework (React DOM, Next runtime) is about 125 kB of this.
  { path: '/', kb: 180 },
  { path: '/shop', kb: 180 },
  { path: '/shop/kitchen', kb: 180 },
  { path: '/products/ridgeline-2p-tent', kb: 180 },
  { path: '/cart', kb: 180 },
  // Account pages add form handling and validation.
  { path: '/sign-in', kb: 230 },
  { path: '/register', kb: 230 },
];

const chunk = (src) => readFileSync(new URL(`../.next/static/chunks/${src.split('/chunks/')[1]}`, import.meta.url));
let failed = false;
for (const { path, kb } of BUDGETS) {
  const html = await (await fetch(BASE + path)).text();
  const scripts = [...new Set([...html.matchAll(/<script src="(\/_next\/static\/chunks\/[^"]+\.js)"([^>]*)>/g)].filter((m) => !/noModule/i.test(m[2])).map((m) => m[1]))];
  const bytes = scripts.reduce((n, s) => n + gzipSync(chunk(s), { level: 9 }).length, 0);
  const size = bytes / 1024;
  const ok = size <= kb;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${path.padEnd(30)} ${size.toFixed(1).padStart(6)} kB of ${kb} kB (${scripts.length} scripts)`);
}
if (failed) {
  console.error('\nFirst-load JavaScript is over budget. See docs/DESIGN.md section 5.5.');
  process.exit(1);
}
