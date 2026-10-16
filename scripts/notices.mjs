import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Preserve third-party license notices for production packages bundled into the VSIX.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['Third-party notices\n\nLiMR for VS Code bundles the following production dependencies.\n'];
for (const [directory, info] of Object.entries(lock.packages)) {
  if (!directory || info.dev || !directory.startsWith('node_modules/')) continue;
  try {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const names = await readdir(directory);
    const licenses = names.filter(name => /^(?:licen[sc]e|copying|notice)(?:\.|$)/i.test(name));
    notices.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'See package license')}\n`);
    for (const name of licenses) {
      try { notices.push(`\n${name}\n${await readFile(path.join(directory, name), 'utf8')}\n`); } catch { /* Some packages use a directory for license material. */ }
    }
  } catch { /* Platform-optional dependency not installed. */ }
}
// LiMR includes its Maple font and KaTeX notices below dist rather than at
// package root. These licenses must travel with the bundled font assets.
for (const file of ['dist/THIRD_PARTY_LICENSES.txt', 'dist/fonts/LICENSE.txt']) {
  const location = path.join('node_modules/@linloir/limr', file);
  notices.push(`\n${'='.repeat(72)}\n@linloir/limr/${file}\n${await readFile(location, 'utf8')}\n`);
}
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('').trimEnd() + '\n');
