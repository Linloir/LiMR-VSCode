import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Every supported VS Code webview supports WOFF2. Remove the older encodings
// from the CSS before bundling so esbuild never emits their duplicate assets.
// Keep every font face, weight and style, including all Maple/Noto subsets.
export function woff2Stylesheet(source) {
  let faces = 0;
  const result = source.replace(/@font-face\s*\{[^}]*\}/g, face => {
    ++faces;
    if (!/\bsrc\s*:/.test(face)) throw new Error('Math font face has no source.');
    return face.replace(/\bsrc\s*:\s*([^;}]+)/, (_declaration, sources) => {
      const woff2 = sources.split(',').map(value => value.trim()).filter(value => /\bformat\(["']woff2["']\)/.test(value));
      if (woff2.length !== 1) throw new Error('Expected one WOFF2 source for every math font face.');
      return `src:${woff2[0]}`;
    });
  });
  if (!faces) throw new Error('Math stylesheet has no font faces; review the font build.');
  return result;
}

export function webviewFontsPlugin() {
  const math = require.resolve('@linloir/limr/math.css');
  return {
    name: 'webview-woff2-fonts',
    setup(build) {
      build.onLoad({ filter: /[/\\]math\.css$/ }, async args => {
        if (args.path !== math) return;
        return { contents: woff2Stylesheet(await readFile(args.path, 'utf8')), loader: 'css' };
      });
    },
  };
}
