import assert from 'node:assert/strict';

// Execute the real published/adapted request, commit, refresh, move and viewport
// closures. Only DOM geometry, React commit delivery, typography and RAF are
// controlled. This validates algorithm convergence, not rendered paint timing.
export function simulateSourceNavigation(module) {
  const from = module.indexOf('    if (!windowed) return;\n    const element = host.current, content = window2.current;');
  const to = module.indexOf('    runtime.documentViewport = viewport;', from) + '    runtime.documentViewport = viewport;'.length;
  assert.ok(from > 0 && to > from);
  const effect = module.slice(from, to);
  const geometry = module.slice(module.indexOf('var BlockHeightIndex = class {'), module.indexOf('// src/react/windowed-headings.ts'));
  const helperStart = module.indexOf('function __limrSourcePositionTop(');
  const helper = helperStart < 0 ? '' : module.slice(helperStart, module.indexOf('\nfunction restoreReadingPosition(', helperStart));
  const entries = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), range: { start: index * 100, end: index * 100 + 100 }, node: { type: 'paragraph' } }));
  const actual = entries.map((_, index) => [72, 220, 40, 350, 120][index % 5]);
  const store = initial => ({ value: initial, get() { return this.value; }, set(value) { this.value = value; } });
  const queues = new Map(), commands = [], pendingTypography = new Set();
  let nextFrame = 1, tick = 0, scheduledView, typographyVersion = 1, api;
  const root = { scrollTop: 0, clientHeight: 500, getBoundingClientRect: () => ({ top: 0 }), scrollTo({ top }) {
    const before = this.scrollTop; this.scrollTop = Math.max(0, Math.min(top, Math.max(0, refs.committedView.current.height - this.clientHeight + 18)));
    commands.push({ tick, before, target: top, after: this.scrollTop });
    if (api && before !== this.scrollTop) api.scroll();
  } };
  Object.defineProperty(root, 'scrollHeight', { get: () => refs.committedView.current.height + 18 });
  const config = { scrollRoot: root, scrollOffset: 18 };
  const initial = { start: 0, end: 8, top: 0, height: 1000, printing: false, slots: Array.from({ length: 8 }, (_, index) => ({ index, top: index * 80 })) };
  const refs = { latest: { current: initial }, committedView: { current: initial }, measureCommitted: { current: null }, captureCommitted: { current: null }, refineAfterCommit: { current: false }, currentHeadings: { current: [] } };
  const runtime = { blocks: new Map(), headings: new Map(), content: {}, getContentOffset: () => 0,
    getViewportTop: () => 0, documentOffset: store(0), layoutScrollAdjustment: store(0), getHeadingActivationInset: () => 18,
    document: { getSnapshot: () => ({ source: 'x'.repeat(100000), revision: 1 }) }, configuration: store(config), presentation: store(1),
    interaction: store({}), decorations: store({ occurrences: [], highlights: new Map(), referenceRanges: new Map() }), requestLayout() {},
  };
  const ownerDocument = { activeElement: null }, prose = { setAttribute() {}, removeAttribute() {} };
  const element = { clientWidth: 500, ownerDocument, closest: () => prose, getBoundingClientRect: () => ({ top: 18 - root.scrollTop }) };
  const slots = new Map();
  const content = { querySelectorAll: () => [...slots.values()] };
  const mount = view => {
    slots.clear(); runtime.blocks.clear(); let flow = view.top;
    for (const { index } of view.slots) {
      const top = flow; flow += actual[index];
      const slot = { dataset: { windowSlot: String(index) }, getBoundingClientRect: () => ({ top: 18 + top - root.scrollTop, bottom: 18 + top - root.scrollTop + actual[index], height: actual[index] }) };
      const node = { index, dataset: { sourceStart: String(index * 100) }, getBoundingClientRect: slot.getBoundingClientRect,
        closest: selector => selector === '[data-window-slot]' ? slot : null, contains: () => false, querySelector: () => null };
      slots.set(index, slot); runtime.blocks.set(String(index), node);
    }
  };
  mount(initial);
  const bindings = { windowed: true, host: { current: element }, window2: { current: content }, config, runtime, entries,
    sourceOrder: entries.map((block, index) => ({ block, index })), overscan: 300, ...refs,
    getComputedStyle: () => ({ fontSize: '16', lineHeight: '28' }),
    requestAnimationFrame: fn => { const id = nextFrame++; queues.set(id, fn); return id; }, cancelAnimationFrame: id => queues.delete(id),
    typographyLayoutVersion: () => typographyVersion, windowedKeepAliveBlocks: () => new Set(),
    // Plain-paragraph fixture: no collapsed code needs preparation before reveal.
    prepareSourceReveal: () => false,
    sourceTypographyPending: (_runtime, node) => pendingTypography.has(node.index),
    sourceRangeStartRect: (_runtime, range) => {
      const node = runtime.blocks.get(String(Math.floor(range.start / 100)));
      return node ? { top: node.getBoundingClientRect().top + range.start % 100 / 100 * actual[node.index] } : null;
    },
    captureReadingPosition: (_runtime, block) => ({ source: Number(block.element.dataset.sourceStart), offset: block.rect.top }),
    setView: view => { scheduledView = view; }, observed: new Set(), resize: { observe() {}, unobserve() {} },
  };
  api = new Function(...Object.keys(bindings), `${geometry}\n${helper}\n${effect}\nreturn { viewport, refresh, committed, schedule, scroll, request, requested: () => requested, logical: () => logical };`)(...Object.values(bindings));
  const commit = () => {
    if (!scheduledView) return false;
    const view = scheduledView; scheduledView = undefined;
    refs.latest.current = view; refs.committedView.current = view;
    mount(view); api.committed(); return true;
  };
  const frame = () => {
    tick++; const frames = [...queues.values()]; queues.clear(); for (const fn of frames) fn(tick * 16);
    // One React commit turn is delivered per explicit frame. A new setView
    // remains pending, exposing latest-target replacement while commit waits.
    commit();
  };
  const settle = (limit = 100) => {
    for (let count = 0; count < limit; count++) {
      if (!queues.size && !scheduledView && !api.requested()) return count;
      frame();
    }
    return null;
  };
  api.refresh(true); settle();
  const reveal = source => api.viewport.reveal({ start: source, end: source + 2 }, 18);
  const glyphError = source => bindings.sourceRangeStartRect(runtime, { start: source })?.top - 18;
  return { reveal, frame, settle, glyphError, root, commands, api,
    pendingTypography, markTypographyReady(index, height) { pendingTypography.delete(index); actual[index] = height ?? actual[index]; typographyVersion++; api.schedule(); },
    cancel: () => api.request(), state: () => ({ tick, top: root.scrollTop, requested: api.requested(), scheduled: !!scheduledView, queuedFrames: queues.size }) };
}
