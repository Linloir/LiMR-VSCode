import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { scrollCompatibilityModules } from '../scripts/limr-scroll.mjs';
import { windowConvergence } from './window-convergence-fixture.mjs';

const require = createRequire(import.meta.url);
const directory = path.join(path.dirname(require.resolve('@linloir/limr/package.json')), 'dist');
const files = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.js')).map(async name => ({
  filename: path.join(directory, name), source: await readFile(path.join(directory, name), 'utf8'),
})));

it('refuses to silently carry the compatibility correction onto an unreviewed release', () => {
  expect(() => scrollCompatibilityModules(files, '1.3.7')).toThrow(/Review the LiMR scroll adapter/);
});

it('rejects source drift or an ambiguous module before bundling any compatibility correction', () => {
  const target = files.find(file => file.source.includes('function WindowedBlocks('));
  expect(() => scrollCompatibilityModules(files.map(file => file === target ? { ...file, source: file.source + '\n' } : file), '1.3.6')).toThrow(/reviewed npm artifact/);
  expect(() => scrollCompatibilityModules([...files, target], '1.3.6')).toThrow(/exactly one/);
  expect(() => scrollCompatibilityModules(files, '1.3.6')).not.toThrow();
});

it('measures every cold native window before paint instead of exposing an estimated prefix', () => {
  const target = files.find(file => file.source.includes('function WindowedBlocks('));
  const source = scrollCompatibilityModules(files, '1.3.6').get(target.filename);
  // 100px estimates become 30px blocks. Expanding overscan takes 10 measurements;
  // yielding before measurement #3 previously painted the anchor at -490px,
  // then -140px and -70px before correcting it on the third following frame.
  const trace = windowConvergence(source);
  expect(trace[0].measurements).toBeGreaterThan(2);
  expect(trace.every(paint => Math.abs(paint.glyph) < .01)).toBe(true);
  expect(trace.at(-1).pendingFrames).toBe(0);
});

it('bounds pathological native convergence after measuring the displayed window', () => {
  const target = files.find(file => file.source.includes('function WindowedBlocks('));
  const source = scrollCompatibilityModules(files, '1.3.6').get(target.filename);
  // Tiny custom blocks require hundreds of successive window expansions.
  // They must yield below React's update limit while retaining the same glyph.
  const trace = windowConvergence(source, { actualHeight: 1, count: 10000, target: 5000 });
  expect(trace.length).toBeGreaterThan(2);
  expect(Math.max(...trace.map(paint => paint.measurements))).toBeLessThan(45);
  expect(trace.every(paint => Math.abs(paint.glyph) < .01)).toBe(true);
  expect(trace.at(-1).pendingFrames).toBe(0);
});

it.each([{ parkedResize: true }, { widthResize: true }])('keeps retained window geometry aligned when capped: %j', resize => {
  const target = files.find(file => file.source.includes('function WindowedBlocks('));
  const source = scrollCompatibilityModules(files, '1.3.6').get(target.filename);
  const trace = windowConvergence(source, { actualHeight: 1, count: 10000, target: 5000, ...resize });
  expect(trace.every(paint => Math.abs(paint.glyph) < .01)).toBe(true);
  expect(trace.at(-1).pendingFrames).toBe(0);
});

it('retains an out-of-window source request when its next window is deferred', () => {
  const target = files.find(file => file.source.includes('function WindowedBlocks('));
  const source = scrollCompatibilityModules(files, '1.3.6').get(target.filename);
  const trace = windowConvergence(source, { actualHeight: 1, count: 10000, target: 5000, sourceSeekAtCap: 9000 });
  expect(trace[0].end).toBeLessThan(9000);
  expect(trace[0].requestedSource).toBe(900000);
  expect(trace[0].pendingFrames).toBeGreaterThan(0);
  expect(trace.some(paint => paint.start <= 9000 && paint.end > 9000)).toBe(true);
});
