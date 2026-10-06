// Bundles the server and CLI into dist/ as single ESM files with no native modules.
// node:sqlite and other built-ins stay external; everything else is inlined.
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

await build({
  entryPoints: ['src/server.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: false,
  legalComments: 'none',
  // Lets bundled CommonJS dependencies call require() for built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }) + '\n');
