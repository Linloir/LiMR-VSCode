import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { scrollCompatibilityModules } from '../scripts/limr-scroll.mjs';
import { simulateSourceNavigation } from './fixtures/scroll-navigation-model.mjs';

const require = createRequire(import.meta.url);
const directory = path.join(path.dirname(require.resolve('@linloir/limr/package.json')), 'dist');
const files = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.js')).map(async name => ({
  filename: path.join(directory, name), source: await readFile(path.join(directory, name), 'utf8'),
})));
const published = files.find(file => file.source.includes('function WindowedBlocks('));
const adapted = scrollCompatibilityModules(files, '1.3.5').get(published.filename);

// These cases execute real core navigation closures. Controlled DOM rectangles,
// React commits, typography and RAF verify algorithm convergence, not paint or
// performance. Require the latest glyph to align and the request queue to drain.
function expectSettled(sim, source) {
  expect(sim.settle(20), 'source navigation retires within the bounded fixture').not.toBeNull();
  expect(Math.abs(sim.glyphError(source)), 'actual source glyph aligns with the 18px reading edge').toBeLessThanOrEqual(1);
  expect(sim.state()).toMatchObject({ requested: undefined, scheduled: false, queuedFrames: 0 });
}

it.each([
  ['forward', [50005, 50110, 55075, 70080]],
  ['backward', [80080, 70075, 45010, 30005]],
])('retains only the latest cold source target while %s requests precede a commit', (_direction, sources) => {
  const sim = simulateSourceNavigation(adapted);
  for (const source of sources) sim.reveal(source);
  expectSettled(sim, sources.at(-1));
});

it('converges to a replacement source target arriving during a pending virtual commit', () => {
  const sim = simulateSourceNavigation(adapted);
  sim.reveal(50020); sim.frame(); sim.reveal(50080);
  expectSettled(sim, 50080);
});

it('does not replay a superseded cold seek when its typography finishes after a newer request', () => {
  const sim = simulateSourceNavigation(adapted);
  sim.pendingTypography.add(500); sim.reveal(50020);
  for (let count = 0; count < 6; count++) sim.frame();
  sim.pendingTypography.add(700); sim.reveal(70080); sim.frame();
  sim.markTypographyReady(500, 500); sim.frame();
  sim.markTypographyReady(700, 220);
  expectSettled(sim, 70080);
});

it('moves directly forward inside a mounted paragraph instead of revisiting its block start', () => {
  const sequence = module => {
    const sim = simulateSourceNavigation(module);
    sim.reveal(50060); expectSettled(sim, 50060);
    const before = sim.root.scrollTop, start = sim.commands.length;
    sim.reveal(50070); expectSettled(sim, 50070);
    return { before, commands: sim.commands.slice(start) };
  };
  // Negative control: unchanged published core reveals the block start first,
  // making a forward source update briefly move the reader backward by 25px.
  const original = sequence(published.source);
  expect(original.commands.some(command => command.after < original.before - 20)).toBe(true);
  const fixed = sequence(adapted);
  expect(fixed.commands).toHaveLength(1);
  expect(fixed.commands[0].after).toBeGreaterThan(fixed.before);
});
