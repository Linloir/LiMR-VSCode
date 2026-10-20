import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrollCompatibilityModules } from './limr-scroll.mjs';
import { commandCompatibilityModules } from './limr-commands.mjs';

const require = createRequire(import.meta.url);
const allocator = fileURLToPath(new URL('../src/shared/annotation-ids.ts', import.meta.url));
const symbol = '__limrShortAnnotationId';
// LiMR 1.2.3/1.3.x have no ID allocator hook. Adapt only their four verified creation expressions,
// before bundling, to preserve automatic-highlight ownership and cancellation.
// Never rewrite serialized source or replace crypto.randomUUID globally.
const replacements = [
  ['const highlight = { id: `highlight-${crypto.randomUUID()}`, type: "highlight",', `const highlight = { id: ${symbol}(doc), type: "highlight",`],
  ['const name = partial && index ? `r-${crypto.randomUUID()}` : id;', `const name = partial && index ? ${symbol}(document2) : id;`],
  ['const id = `r-${crypto.randomUUID()}`;', `const id = ${symbol}(document2);`],
  ['context.addAnnotation({ id: `highlight-${crypto.randomUUID()}`, type: "highlight",', `context.addAnnotation({ id: ${symbol}(context.document), type: "highlight",`],
];

export function shortAnnotationIdsPlugin() {
  return {
    name: 'limr-short-annotation-ids',
    setup(build) {
      const patched = new Map(), loaded = new Set();
      build.onStart(async () => {
        patched.clear(); loaded.clear();
        const manifest = require.resolve('@linloir/limr/package.json');
        const version = JSON.parse(await readFile(manifest, 'utf8')).version;
        if (version !== '1.3.10') {
          throw new Error('The LiMR host adapters require reviewed @linloir/limr version 1.3.10.');
        }
        const directory = path.join(path.dirname(manifest), 'dist');
        const files = await Promise.all((await readdir(directory)).filter(file => file.endsWith('.js')).map(async file => {
          const filename = path.join(directory, file); return { filename, source: await readFile(filename, 'utf8') };
        }));
        const hostModules = new Map([...scrollCompatibilityModules(files, version), ...commandCompatibilityModules(files, version)]);
        for (const [before] of replacements) {
          const count = files.reduce((sum, file) => sum + file.source.split(before).length - 1, 0);
          if (count !== 1) throw new Error(`LiMR short-ID adapter expected exactly one creation site: ${before} (found ${count}).`);
        }
        const uuidCount = files.reduce((sum, file) => sum + file.source.split('crypto.randomUUID()').length - 1, 0);
        if (uuidCount !== 4) throw new Error(`LiMR short-ID adapter expected four UUID creation sites, found ${uuidCount}.`);
        if (files.filter(file => file.source.includes('function editSourceAnnotations(change, document2) {')).length !== 1) {
          throw new Error('LiMR source annotation serializer binding changed; review the short-ID adapter.');
        }
        for (const { filename, source } of files) {
          let transformed = hostModules.get(filename) ?? source;
          for (const [before, after] of replacements) transformed = transformed.replace(before, after);
          if (transformed !== source) patched.set(filename, `import { shortAnnotationId as ${symbol} } from ${JSON.stringify(allocator)};\n${transformed}`);
        }
      });
      build.onLoad({ filter: /[/\\]@linloir[/\\]limr[/\\]dist[/\\][^/\\]+\.js$/ }, args => {
        const contents = patched.get(args.path);
        if (contents === undefined) return;
        loaded.add(args.path);
        return { contents, loader: 'js' };
      });
      build.onEnd(result => {
        if (!result.errors.length && loaded.size !== patched.size) return { errors: [{ text: 'The LiMR short-ID adapter was not applied to all expected modules.' }] };
      });
    },
  };
}
