import assert from 'node:assert/strict';

const between = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing reviewed core section: ${start}`);
  return source.slice(from, to);
};

/**
 * Execute the shipped height index, commit, refresh, and committed-measurement
 * functions. Only DOM heights and React's commit/RAF delivery are simulated.
 * Each recorded paint happens after all synchronous layout-effect updates, so
 * a premature yield exposes a visible prefix error without a browser/font race.
 */
export function windowConvergence(source, { actualHeight = 30, count = 1000, target = 200,
  parkedResize = false, widthResize = false, sourceSeekAtCap = null } = {}) {
  const heightIndex = between(source, 'var BlockHeightIndex = class {', '// src/react/windowed-headings.ts');
  const windowed = source.slice(source.indexOf('function WindowedBlocks('));
  const commit = between(windowed, '    const commit = () => {', '    const move = (next');
  const move = between(windowed, '    const move = (next', '    const rememberPosition = ');
  const refresh = between(windowed, '    const refresh = (measure) => {', '    const viewport = {');
  return new Function('actualHeight', 'count', 'target', 'parkedResize', 'widthResize', 'sourceSeekAtCap', `${heightIndex}
    let physical = target * 100, domView, pendingView, measuredWindow;
    const trace = [], rafs = new Map();
    let rafId = 0;
    const requestAnimationFrame = callback => { rafs.set(++rafId, callback); return rafId; };
    const cancelAnimationFrame = id => rafs.delete(id);
    let heights = new BlockHeightIndex(Array(count).fill(100));
    let geometry = readingScrollGeometry(heights.total, 900);
    let logical = physical, origin = 0, frame = 0, pendingMeasure = false;
    let disposed = false, printing = false, translating = false;
    let width = 800, line = 30, measuredTypography = 0;
    let committedMeasurements = 0, measurementResetFrame = 0;
    let requested, bottomAnchor, readingAnchor, logicalPosition;
    let parkedResized = false, widthResized = false;
    const entries = Array.from({ length: count }, (_, index) => ({
      id: String(index), range: { start: index * 100, end: (index + 1) * 100 },
    }));
    const initial = { start: 0, end: 0, top: 0, height: geometry.height, printing: false, slots: [] };
    const latest = { current: initial }, committedView = { current: initial };
    const refineAfterCommit = { current: false }, measureCommitted = { current: null };
    const config = { scrollRoot: null, scrollOffset: 0 };
    const positions = new Map(entries.map((entry, index) => [entry.id, index]));
    const customLeases = new Set(), media = new Set();
    if (parkedResize) customLeases.add(0);
    const runtime = {
      getContentOffset: () => 0,
      interaction: { get: () => ({}) }, decorations: { get: () => ({}) },
      blocks: new Map(), anchors: new Map(), documentOffset: { set() {} },
      configuration: { get: () => config }, presentation: { get: () => 0 },
      document: { getSnapshot: () => ({ revision: 1 }) },
      requestLayout() {},
    };
    if (parkedResize) runtime.blocks.set('0', { querySelector: () => null, contains: () => false });
    const element = { get clientWidth() {
        if (widthResize && committedMeasurements >= 16) widthResized = true;
        return widthResized ? 400 : 800;
      }, ownerDocument: { activeElement: null },
      getBoundingClientRect: () => ({ top: -physical }) };
    const content = { querySelectorAll: () => domView.slots.map(slot => ({
      dataset: { windowSlot: String(slot.index) },
      getBoundingClientRect: () => {
        if (parkedResize && committedMeasurements >= 16) parkedResized = true;
        return { height: parkedResize && slot.index === 0 ? (parkedResized ? 130 : 100) : actualHeight };
      },
    })) };
    const viewportHeight = () => 900, viewportTop = () => 0, physicalTop = () => physical;
    const logicalAt = value => value, typographyLayoutVersion = () => 0;
    const retainLogicalPosition = () => {}, rememberPosition = () => {};
    const compensateScroll = value => { physical = value; };
    const setView = value => { pendingView = value; };
    const observed = new Set(), resize = { observe() {}, unobserve() {} }, overscan = 1400;
    const scrollRoot = { scrollTo: ({ top }) => { physical = top; } };
    const sourceIndex = offset => Math.min(count - 1, Math.floor(offset / 100));
    const request = next => { requested = next; };
    ${commit}
    ${move}
    ${refresh}
    function flushReact() {
      let commits = 0;
      while (pendingView) {
        if (++commits > 45) throw new Error('Nested update limit approached');
        domView = pendingView;
        pendingView = undefined;
        latest.current = domView;
        committedView.current = domView;
        const currentWidth = element.clientWidth;
        if (refineAfterCommit.current || !measuredWindow || measuredWindow.start !== domView.start
          || measuredWindow.end !== domView.end || measuredWindow.width !== currentWidth) {
          refineAfterCommit.current = false;
          measuredWindow = { start: domView.start, end: domView.end, width: currentWidth };
          committed();
        }
      }
    }
    function paint() {
      trace.push({ start: domView.start, end: domView.end, physical,
        glyph: domView.top + (target - domView.start) * actualHeight - physical,
        measurements: committedMeasurements, pendingFrames: rafs.size,
        requestedSource: requested?.range.start ?? null });
    }
    commit(); flushReact();
    if (sourceSeekAtCap !== null) {
      if (committedMeasurements < 16) throw new Error('Source cap probe needs a capped fixture');
      requested = { range: { start: sourceSeekAtCap * 100, end: sourceSeekAtCap * 100 + 2 }, offset: 0 };
      refresh(true); flushReact();
    }
    paint();
    for (let number = 0; number < 80 && rafs.size; number++) {
      const callbacks = [...rafs.values()];
      rafs.clear();
      for (const callback of callbacks) callback();
      flushReact(); paint();
    }
    return trace;
  `)(actualHeight, count, target, parkedResize, widthResize, sourceSeekAtCap);
}
