// Deterministic independent-prose inputs. Run before, never during, a timed run.
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? '/tmp/limr-vscode-novels');
const sizes = (process.env.BENCH_NOVEL_MIB ?? '50,75').split(',').map(Number);
if (!sizes.length || sizes.some(size => !Number.isInteger(size) || size < 1 || size > 1024)) throw new Error('BENCH_NOVEL_MIB accepts positive whole MiB values up to 1024.');
await mkdir(directory, { recursive: true });
const phrase = '夕阳落在山间，河水从村庄旁缓缓流过。远处的旅人沿着小路走来，手中带着一本旧书。书中记载了许多故事，人们在灯下阅读，又在清晨开始新的生活。';
const reports = [];
for (const mib of sizes) {
  const name = `novel-${mib}MiB.md`, stream = createWriteStream(path.join(directory, name)), hash = createHash('sha256');
  let bytes = 0, chars = 0, paragraphs = 0;
  const append = async text => {
    const body = Buffer.from(text); hash.update(body); bytes += body.length; chars += text.length;
    if (!stream.write(body)) await once(stream, 'drain');
  };
  const ending = '# Final chapter\n\nTHE-END-OF-THE-COMPLETE-BOOK\n';
  const target = mib * 1024 * 1024;
  await append('# Start\n\n');
  while (bytes < target - Buffer.byteLength(ending)) {
    // Distinct source offsets/text make an accidental top/middle/tail repeat
    // detectable; paragraphs stay independent and contain no translation UI.
    const chunk = [];
    for (let index = 0; index < 64; index++) chunk.push(`Paragraph ${++paragraphs}. ${phrase.repeat(6)}\n\n`);
    const body = chunk.join('');
    if (bytes + Buffer.byteLength(body) + Buffer.byteLength(ending) > target) {
      // Exact byte boundaries matter for the 75 MiB host limit. Fill with an
      // ASCII paragraph and preserve the final heading/sentinel.
      const remaining = target - bytes - Buffer.byteLength(ending);
      await append(remaining >= 2 ? 'x'.repeat(remaining - 2) + '\n\n' : '\n'.repeat(remaining));
      break;
    }
    await append(body);
  }
  await append(ending);
  stream.end(); await finished(stream);
  reports.push({ name, requestedMiB: mib, bytes, chars, paragraphs, sha256: hash.digest('hex') });
}
await writeFile(path.join(directory, 'novels.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify({ directory, reports }, null, 2));
