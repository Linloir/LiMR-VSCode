import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const inputs = ['src', 'webview', 'scripts', 'benchmarks/reading', 'tsconfig.json', 'package.json', 'package-lock.json', 'package.nls.json', 'package.nls.zh-cn.json'];
export async function fileHashes(directory) {
  const entries = [];
  async function visit(relative) {
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      if (item.isDirectory()) await visit(name);
      else if (item.isFile()) entries.push([name, sha256(await readFile(path.join(directory, name)))]);
    }
  }
  await visit(''); return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}
export async function fingerprints() {
  const files = {};
  for (const input of inputs) {
    if (input.endsWith('.json')) files[input] = sha256(await readFile(path.join(root, input)));
    else for (const [name, hash] of Object.entries(await fileHashes(path.join(root, input)))) files[`${input}/${name}`] = hash;
  }
  const core = await fileHashes(path.join(root, 'node_modules/@linloir/limr/dist'));
  return { sourceSHA256: sha256(JSON.stringify(files)), coreSHA256: sha256(JSON.stringify(core)) };
}
export async function prepareCandidate(output) {
  const before = await fingerprints();
  if (process.env.BENCH_NO_BUILD === '1') {
    if (!process.env.BENCH_READING_BUILD) throw new Error('BENCH_NO_BUILD requires BENCH_READING_BUILD pointing to a frozen extension.');
    const directory = path.resolve(process.env.BENCH_READING_BUILD);
    const manifest = JSON.parse(await readFile(path.join(directory, 'reading-build.json'), 'utf8'));
    if (Object.entries(before).some(([name, hash]) => manifest[name] !== hash)) throw new Error('Source, harness, lockfile or installed core differs from the saved build.');
    if (JSON.stringify(await fileHashes(path.join(directory, 'dist'))) !== JSON.stringify(manifest.assets)) throw new Error('Saved build assets have changed.');
    return { directory, manifest };
  }
  const directory = await mkdtemp(path.join(output, 'extension-'));
  for (const input of [...inputs, 'media', 'skills', 'docs', 'api', 'LICENSE']) {
    await mkdir(path.dirname(path.join(directory, input)), { recursive: true });
    await cp(path.join(root, input), path.join(directory, input), { recursive: true });
  }
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  if (JSON.stringify(await fingerprints()) !== JSON.stringify(before)) throw new Error('Source changed while freezing the build; retry without concurrent edits.');
  // The normal production build runs in a separate process and exits before
  // Electron starts. No workspace dist or installed VS Code is changed.
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['scripts/build.mjs'], {
    cwd: directory, env: { ...process.env, NODE_ENV: 'production' }, maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(path.join(directory, 'build.log'), stdout + stderr);
  if (JSON.stringify(await fingerprints()) !== JSON.stringify(before)) throw new Error('Source or installed core changed during the build; the candidate is not accepted.');
  const manifest = { ...before, builtAt: new Date().toISOString(), node: process.version,
    extensionVersion: JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')).version,
    coreVersion: JSON.parse(await readFile(path.join(root, 'node_modules/@linloir/limr/package.json'), 'utf8')).version,
    assets: await fileHashes(path.join(directory, 'dist')), production: true,
  };
  for (const asset of ['extension.cjs', 'syntax-worker.cjs', 'webview/main.js', 'webview/main.css', 'webview/reader-worker.js']) {
    if (!manifest.assets[asset]) throw new Error(`Missing production asset: ${asset}`);
  }
  await writeFile(path.join(directory, 'reading-build.json'), JSON.stringify(manifest, null, 2));
  return { directory, manifest };
}
