// Bundles the API into dist/server.js for `npm start` (CI, any Node host). Our code and the @halden/*
// workspace packages (TypeScript sources) are bundled; npm dependencies stay imports from node_modules.
import { build } from 'esbuild';

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
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [externalDependencies],
  logLevel: 'info',
});
