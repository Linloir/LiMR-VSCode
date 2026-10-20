import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { listFiles, PackageManager } from '@vscode/vsce';

// Use the packager's own file selection, not a second implementation of ignore
// rules. This also catches forgotten resources when the allowlist changes.
const files = (await listFiles({ packageManager: PackageManager.None })).sort();
const included = new Set(files);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const outputs = JSON.parse(await readFile('artifacts/build-outputs.json', 'utf8'));
const required = [
  manifest.main.replace(/^\.\//, ''), manifest.icon,
  'dist/syntax-worker.cjs', 'dist/webview/main.js', 'dist/webview/main.css', 'dist/webview/reader-worker.js',
  'package.json', 'package.nls.json', 'package.nls.zh-cn.json',
  'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'api/index.d.ts',
  'docs/ai-guide.md', 'docs/ai-guide.en.md',
  'skills/limr-annotations/SKILL.md', 'skills/limr-annotations/scripts/write-question.cjs',
  ...['authoring', 'limr-syntax', 'reader-plugins', 'source-annotations'].map(name => `skills/limr-annotations/references/${name}.md`),
];
for (const file of required) assert.ok(included.has(file), `Missing offline/runtime resource: ${file}`);
for (const [file, output] of Object.entries(outputs)) {
  assert.ok(included.has(file), `Build output excluded from VSIX: ${file}`);
  assert.equal((await stat(file)).size, output.bytes, `Stale build output: ${file}; run npm run build.`);
  for (const reference of output.imports) {
    if (!reference.external) assert.ok(included.has(reference.path), `${file} references an unpackaged resource: ${reference.path}`);
  }
  if (output.cssBundle) assert.ok(included.has(output.cssBundle), `Missing stylesheet: ${output.cssBundle}`);
}
for (const file of files) {
  assert.ok(!/^(?:node_modules|src|webview|tests|scripts|benchmarks|examples|artifacts)\//.test(file), `Development file in VSIX: ${file}`);
  assert.ok(!/\.(?:map|ttf|woff)$/.test(file), `Unnecessary source map or legacy font: ${file}`);
  if (file.startsWith('dist/')) assert.ok(outputs[file], `Stale/unbuilt asset in VSIX: ${file}`);
}
for (const worker of ['dist/syntax-worker.cjs', 'dist/webview/reader-worker.js']) {
  const inputs = Object.keys(outputs[worker].inputs);
  assert.ok(!inputs.some(file => /node_modules\/(?:react(?:-dom)?|katex|mermaid|shiki)\//.test(file)), `${worker} must contain parser code only.`);
}
// These full offline font sets are deliberate; a size optimization must not
// silently remove styles, CJK/rare-character subsets, or math glyphs.
const fontCounts = {
  maple: files.filter(file => /\/maple-[^/]+\.woff2$/.test(file)).length,
  noto: files.filter(file => /\/noto-serif-sc-[^/]+\.woff2$/.test(file)).length,
  katex: files.filter(file => /\/KaTeX_[^/]+\.woff2$/.test(file)).length,
};
assert.deepEqual(fontCounts, { maple: 314, noto: 101, katex: 20 }, 'Review any change to the complete offline font sets.');
const unpackedBytes = (await Promise.all(files.map(async file => (await stat(file)).size))).reduce((sum, size) => sum + size, 0);
assert.ok(files.length <= 980, `VSIX file budget exceeded: ${files.length} > 980.`);
assert.ok(unpackedBytes <= 60_000_000, `VSIX unpacked budget exceeded: ${unpackedBytes} > 60,000,000.`);
const report = { version: manifest.version, coreVersion: manifest.dependencies['@linloir/limr'], files: files.length, unpackedBytes, fontCounts };
await writeFile('artifacts/package-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
