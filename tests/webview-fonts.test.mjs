import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { woff2Stylesheet } from '../scripts/webview-fonts.mjs';

const require = createRequire(import.meta.url);

it('preserves every real math font face and rule while removing only legacy font sources', async () => {
  const source = await readFile(require.resolve('@linloir/limr/math.css'), 'utf8');
  const result = woff2Stylesheet(source);
  const faces = css => [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(([face]) => face);
  const original = faces(source), modern = faces(result);
  expect(original).toHaveLength(20);
  expect(modern).toHaveLength(original.length);
  for (let i = 0; i < original.length; ++i) {
    expect(modern[i].replace(/src:[^;}]+/, '')).toBe(original[i].replace(/src:[^;}]+/, ''));
    expect(modern[i].match(/src:([^;}]+)/)[1]).toBe(original[i].match(/src:([^,;}]+)/)[1]);
  }
  expect(result.replace(/@font-face\s*\{[^}]*\}/g, '')).toBe(source.replace(/@font-face\s*\{[^}]*\}/g, ''));
  expect(result).not.toMatch(/\.(?:woff|ttf)(?:["')])/);
});

it('requires review instead of deleting a face without a WOFF2 replacement', () => {
  expect(() => woff2Stylesheet('@font-face{font-family:Math;src:url(math.ttf) format("truetype")}')).toThrow(/one WOFF2/);
  expect(() => woff2Stylesheet('@font-face{font-family:Math}')).toThrow(/no source/);
  expect(() => woff2Stylesheet('.math{color:inherit}')).toThrow(/no font faces/);
});
