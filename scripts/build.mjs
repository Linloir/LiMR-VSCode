import { build, context } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { shortAnnotationIdsPlugin } from './annotation-ids.mjs';
import './notices.mjs';

const watch = process.argv.includes('--watch');
if (!watch) await rm('dist', { recursive: true, force: true });
await mkdir('artifacts', { recursive: true });
const configurations = [
  { entryPoints: ['src/syntax-worker.ts'], outfile: 'dist/syntax-worker.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', minify: !watch, logLevel: 'info' },
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true, logLevel: 'info' },
  // Webview workers are fetched as one file and started from a Blob URL. Resolve
  // worker-safe dependency branches; never emit runtime imports or browser DOM decoders.
  { entryPoints: ['webview/reader-worker.ts'], outfile: 'dist/webview/reader-worker.js', bundle: true, splitting: false, format: 'esm', platform: 'browser', conditions: ['worker'], target: 'chrome120', minify: !watch,
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') }, logLevel: 'info' },
  { entryPoints: { main: 'webview/index.tsx' }, outdir: 'dist/webview', bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'chrome120', sourcemap: false, minify: !watch,
    plugins: [shortAnnotationIdsPlugin()],
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.wasm': 'file', '.svg': 'file', '.png': 'file' }, assetNames: 'assets/[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') }, logLevel: 'info' },
];
if (watch) {
  await Promise.all(configurations.map(async options => { const ctx = await context(options); await ctx.watch(); }));
} else await Promise.all(configurations.map(options => build(options)));
