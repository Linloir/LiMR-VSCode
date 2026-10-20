import { createHash } from 'node:crypto';

const reviewedSHA256 = new Set([
  'c95e6d58085e89ba9807922d3dab9413c34fba8a1bb832c0d8730ed513fa858c', // 1.3.11–1.3.13
  '1f7d4c63e286a97a7372811eb2f5563ac0a7ade6bdb2d2fd97af88c6791b989f', // 1.3.14: visibleReadingBlocks iterator
]);

// Apply before the source-position seek correction in limr-scroll.mjs.
// It changes source capture, never scrollTop or virtual-window scheduling.
export function captureFallbackCorrection(module) {
  const start = module.indexOf('function captureReadingPosition(runtime, measuredBlock) {');
  const end = module.indexOf('\nfunction restoreReadingPosition(', start);
  if (start < 0 || end < 0) throw new Error('Expected the published captureReadingPosition helper.');
  const before = module.slice(start, end);
  if (!reviewedSHA256.has(createHash('sha256').update(before).digest('hex')))
    throw new Error('Review the captureReadingPosition source before applying this correction.');
  const replacements = [
    ['  if (!block) return null;\n  for (const leaf', '  if (!block) return null;\n  let preceding;\n  for (const leaf'],
    ['      if (rect2.height && rect2.bottom > edge) return { source: leaf.range.start, offset: rect2.top - viewport };\n      continue;',
      '      if (rect2.height && rect2.bottom > edge) return { source: leaf.range.start, offset: rect2.top - viewport };\n      if (rect2.height) preceding = { leaf, rect: rect2 };\n      continue;'],
    ['    if (range.getBoundingClientRect().bottom <= edge) continue;',
      '    const bounds = range.getBoundingClientRect();\n    if (bounds.height && bounds.width) preceding = { leaf };\n    if (bounds.bottom <= edge) continue;'],
    ['  const source = Number(block.element.dataset.sourceStart);', `  // The paragraph line box can extend below its final glyph. If the reading
  // edge falls in that trailing gap, retain the last actual leaf instead of
  // reporting the paragraph beginning and sending the source editor backward.
  if (preceding?.leaf.kind === "text") {
    const leaf = preceding.leaf, node = leaf.node, range = measurementRange(node.ownerDocument);
    for (let end = node.length; end > 0;) {
      let start = end - 1;
      if (start && /[\\uDC00-\\uDFFF]/.test(node.data[start])) start--;
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = range.getBoundingClientRect();
      if (rect.height && rect.width) return { source: leaf.binding.resolve(leaf.offset + start, "start"), offset: rect.top - viewport };
      end = start;
    }
  } else if (preceding) {
    return { source: preceding.leaf.range.start, offset: preceding.rect.top - viewport };
  }
  const source = Number(block.element.dataset.sourceStart);`],
  ];
  let after = before;
  for (const [needle, replacement] of replacements) {
    if (after.split(needle).length !== 2) throw new Error('Expected one reviewed capture source site.');
    after = after.replace(needle, replacement);
  }
  return [before, after];
}

