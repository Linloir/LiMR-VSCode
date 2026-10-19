import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { captureFallbackCorrection } from '../scripts/limr-source-position.mjs';

const module = await readFile('node_modules/@linloir/limr/dist/chunk-A7XTWZD5.js', 'utf8');
const [before, after] = captureFallbackCorrection(module);
const rect = (top, width = 10, height = 16) => ({ top, bottom: top + height, left: 0, right: width, width, height });
const empty = () => rect(0, 0, 0);

// Controlled DOM Range geometry isolates capture semantics from browser timing.
// The same unmodified helper is a negative control for every fallback case.
function fixture(items) {
  const ownerDocument = {};
  const leaves = items.map(item => {
    if (item.atomic) return { kind: 'image', range: { start: item.source, end: item.source + 8 },
      node: { querySelector: () => null, getBoundingClientRect: () => item.rect } };
    return { kind: 'text', offset: 0, node: { data: item.text, length: item.text.length, ownerDocument, rectangles: item.rectangles },
      binding: { resolve: offset => item.source + offset } };
  });
  const range = () => ({
    node: null, start: 0, end: 0,
    selectNodeContents(node) { this.node = node; this.start = 0; this.end = node.length; },
    setStart(node, start) { this.node = node; this.start = start; },
    setEnd(node, end) { this.node = node; this.end = end; },
    getBoundingClientRect() {
      const boxes = this.node.rectangles.slice(this.start, this.end).filter(box => box.height && box.width);
      if (!boxes.length) return empty();
      const top = Math.min(...boxes.map(box => box.top));
      return rect(top, Math.max(...boxes.map(box => box.width)), Math.max(...boxes.map(box => box.bottom)) - top);
    },
  });
  const capture = source => new Function('leavesIn', 'measurementRange', `return (${source});`)(() => leaves, range);
  const runtime = { content: {}, getViewportTop: () => 0, configuration: { get: () => ({ scrollOffset: 18 }) } };
  const block = { element: { dataset: { sourceStart: '100' } }, rect: rect(-100, 600, 124) };
  return { original: () => capture(before)(runtime, block), corrected: () => capture(after)(runtime, block) };
}

test('a trailing line box reports the final visible glyph, never the paragraph beginning', () => {
  const value = fixture([{ text: 'abcdef', source: 100, rectangles: [-80, -80, -40, -40, 1, 1].map(top => rect(top)) }]);
  assert.deepEqual(value.original(), { source: 100, offset: -100 });
  assert.deepEqual(value.corrected(), { source: 105, offset: 1 });
});

test('capture while a glyph intersects the reading edge is unchanged', () => {
  const value = fixture([{ text: 'abcdef', source: 100, rectangles: [-80, -80, -40, -40, 5, 5].map(top => rect(top)) }]);
  assert.deepEqual(value.corrected(), value.original());
  assert.deepEqual(value.corrected(), { source: 104, offset: 5 });
});

test('the last text leaf wins across inline bindings, skipping collapsed trailing whitespace', () => {
  const value = fixture([
    { text: 'ab', source: 100, rectangles: [rect(-50), rect(-50)] },
    { text: 'cd  ', source: 200, rectangles: [rect(1), rect(1), empty(), empty()] },
  ]);
  assert.equal(value.original().source, 100);
  assert.deepEqual(value.corrected(), { source: 201, offset: 1 });
});

test('a final astral glyph preserves the start of its UTF-16 pair', () => {
  const value = fixture([{ text: 'a😀', source: 100, rectangles: [rect(-40), rect(1), rect(1)] }]);
  assert.deepEqual(value.corrected(), { source: 101, offset: 1 });
});

test('a final atomic leaf preserves its own source and geometry', () => {
  const value = fixture([
    { text: 'ab', source: 100, rectangles: [rect(-50), rect(-50)] },
    { atomic: true, source: 900, rect: rect(-10, 100, 20) },
  ]);
  assert.equal(value.original().source, 100);
  assert.deepEqual(value.corrected(), { source: 900, offset: -10 });
});

test('a block without rendered leaves retains the original block fallback', () => {
  const value = fixture([]);
  assert.deepEqual(value.corrected(), value.original());
});

test('unreviewed capture source is rejected', () => {
  assert.throws(() => captureFallbackCorrection(module.replace('function captureReadingPosition(runtime, measuredBlock) {', 'function captureReadingPosition(runtime, measuredBlock) {\n// drift')), /Review/);
});
