// Bundles the API for running: dist/server.js for `npm start` (CI, any Node host) and dist/vercel.js for the Vercel
// function (api/index.js). Our code and the @halden/* workspace packages (TypeScript sources) are bundled; npm
// dependencies stay imports from node_modules. Vercel also wants an output folder, so public/ gets a robots.txt.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

/** Every bare import is external, except our own workspace packages. */
const externalDependencies = {
  name: 'external-dependencies',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@halden/') ? undefined : { path: args.path, external: true },
    );
  },
};

await build({
  entryPoints: ['src/server.ts', 'src/vercel.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [externalDependencies],
  logLevel: 'info',
});

await mkdir('public', { recursive: true });
await writeFile('public/robots.txt', 'User-agent: *\nDisallow: /\n');
