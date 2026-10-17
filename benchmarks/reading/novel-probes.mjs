// Only the benchmark installs this observer. It uses source-tagged, rendered
// text; it never accesses Reader internals, edits Markdown, or delays a worker.
export function installNovelObservers({ handoff = 'none' } = {}) {
  if (window === window.top) return; // Never poll the large workbench DOM.
  const state = window.__limrNovel = { handoff, frames: [], prefix: null, beforeReady: null, afterReady: [], errors: [], reveals: [], actions: [] };
  const root = () => document.querySelector('.lv-scroll');
  const complete = () => document.querySelector('.lv-app')?.dataset.readerReady === 'true';
  const provisional = () => !!document.querySelector('.lv-load-progress') && !!document.querySelector('.limr-reader');
  const visible = node => {
    if (!node || node.closest('[inert],[data-window-parked],[data-limr-ignore]')) return false;
    const r = node.getBoundingClientRect(), viewport = root()?.getBoundingClientRect();
    if (!viewport || r.bottom <= Math.max(0, viewport.top) || r.top >= Math.min(innerHeight, viewport.bottom)) return false;
    return node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const texts = () => [...document.querySelectorAll('.limr-reader-content > article [data-limr-text][data-source-start]')].filter(visible);
  const sourceText = span => document.createTreeWalker(span, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('[data-limr-ignore]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const charAt = (span, offset) => {
    const source = Number(span.dataset.sourceStart) + offset;
    // KP glue containing an original space must count; zero-length CJK glue
    // contributes no text. Generated hyphens/line breaks are ignored above.
    const walker = sourceText(span); let node;
    while ((node = walker.nextNode())) {
      if (offset < node.length) {
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        return { source, character: node.data.slice(offset, offset + 1), sample: node.data.slice(offset, offset + 33),
          x: box.left, y: box.top - root().getBoundingClientRect().top, height: box.height, scrollTop: root().scrollTop };
      }
      offset -= node.length;
    }
    return null;
  };
  // Novel fixtures contain plain paragraphs; unlike Markdown/source lengths,
  // these source-tagged text spans have a direct UTF-16 character mapping.
  const locate = anchor => {
    if (!anchor) return null;
    const span = texts().filter(node => Number(node.dataset.sourceStart) <= anchor.source && Number(node.dataset.sourceEnd) > anchor.source)
      .sort((a, b) => (Number(a.dataset.sourceEnd) - Number(a.dataset.sourceStart)) - (Number(b.dataset.sourceEnd) - Number(b.dataset.sourceStart)))[0];
    return span ? charAt(span, anchor.source - Number(span.dataset.sourceStart)) : null;
  };
  const capture = () => {
    const viewport = root()?.getBoundingClientRect(), spans = texts();
    if (!viewport || !spans.length) return null;
    const y = Math.max(0, viewport.top) + 24;
    for (const span of spans) {
      const box = span.getBoundingClientRect(); if (box.bottom < y) continue;
      // Locate an actual glyph near the reading line, not the block's box or
      // compressed scrollTop. The binary search is bounded by one paragraph.
      const walker = sourceText(span); let length = 0, node;
      while ((node = walker.nextNode())) length += node.length;
      if (length !== Number(span.dataset.sourceEnd) - Number(span.dataset.sourceStart)) {
        const message = 'The source-tagged plain-text span is not a direct UTF-16 mapping; glyph positioning is unsupported for this fixture.';
        if (!state.errors.includes(message)) state.errors.push(message);
        continue;
      }
      let low = 0, high = Math.max(0, length - 1);
      while (low < high) { const middle = (low + high) >>> 1, point = charAt(span, middle); if (!point || point.y + viewport.top + point.height < y) low = middle + 1; else high = middle; }
      for (let at = low; at < Math.min(length, low + 8); at++) {
        const point = charAt(span, at);
        if (point?.character.trim() && point.height > 0 && point.y < viewport.height) return point;
      }
    }
    return null;
  };
  window.__limrNovelAnchor = capture; window.__limrNovelLocate = locate;
  const gesture = () => {
    const element = root(), amount = Math.min(element.clientHeight * .7, (element.scrollHeight - element.clientHeight) * .45);
    if (!(amount > 40)) throw new Error('The actual prefix is too short to exercise a non-top reading position.');
    const event = new WheelEvent('wheel', { deltaY: amount, bubbles: true, cancelable: true });
    const accepted = element.dispatchEvent(event); if (accepted) element.scrollBy({ top: amount, behavior: 'instant' });
    state.actions.push({ kind: 'reader-wheel', at: performance.now(), amount, complete: complete(), provisional: provisional(), trusted: false });
    state.readingStarted = true;
  };
  const onMessage = event => {
    if (event.data?.type !== 'reveal') return;
    state.reveals.push({ at: performance.now(), offset: event.data.offset, complete: complete(), rootPresent: !!root() });
    // This is deliberately after App's reveal listener has queued the source
    // request. The following real production wheel handler must supersede it.
    if (handoff === 'gesture' && state.prefix && !state.readingStarted && !complete() && provisional()) queueMicrotask(() => {
      if (!complete() && provisional()) { try { gesture(); } catch (error) { state.errors.push(String(error)); } }
    });
  };
  let bootstrap;
  const attach = () => { removeEventListener('message', onMessage); addEventListener('message', onMessage); bootstrap?.observe(document, { childList: true, subtree: true }); };
  attach();
  const nativeOpen = Document.prototype.open;
  Document.prototype.open = function (...args) { const result = Reflect.apply(nativeOpen, this, args); if (this === document) attach(); return result; };
  if (handoff === 'none') return;
  let last = performance.now(), started, finished = false;
  const tick = () => {
    if (finished) return;
    const now = performance.now(), bench = window.__limrReadingBench;
    const prefixResponse = bench?.workers.some(worker => worker.responses.some(response => response.type === 'snapshot' && !response.complete));
    if (!state.prefix && prefixResponse && !complete() && provisional()) {
      const point = capture(), paragraph = texts().find(node => node.closest('p'));
      if (point && paragraph) {
        const box = paragraph.getBoundingClientRect(), viewport = root().getBoundingClientRect();
        const x = Math.max(0, box.left) + Math.min(box.width / 2, 50), y = Math.max(box.top, viewport.top, 0) + 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && (paragraph.contains(hit) || hit.contains(paragraph))) {
          state.prefix = { at: now, anchor: point, heading: root().querySelector('h1,h2,h3')?.textContent, fontStatus: document.fonts.status, scrollHeight: root().scrollHeight };
          started = now;
          if (handoff === 'read') { try { gesture(); } catch (error) { state.errors.push(String(error)); } }
          else if (handoff !== 'initial') void window.__limrBenchRevealSource({ ratio: .8 }).then(result => { state.request = result; }, error => { state.errors.push(String(error)); });
        }
      }
    }
    if (state.prefix) {
      state.frames.push(now - last);
      // The full engine can commit before the host's next ready-state render.
      // Freeze the old glyph as soon as the provisional banner disappears;
      // otherwise sampling the new engine here could hide a handoff jump.
      if (!complete() && provisional() && state.readingStarted) { const point = capture(); if (point) state.beforeReady = { ...point, at: now }; }
      if (complete()) {
        state.readyAt ??= now;
        if (state.afterReady.length < 60) state.afterReady.push({ at: now, anchor: locate(state.beforeReady), current: capture() });
        if (now - state.readyAt > 1000) finished = true;
      }
      if (now - started > 120_000) { state.errors.push('Prefix did not complete within 120 seconds.'); finished = true; }
    }
    if (complete() && !state.prefix) finished = true;
    last = now; if (!finished) requestAnimationFrame(tick);
  };
  let running = false;
  const begin = () => {
    if (running || !document.querySelector('meta[name="limr-parser-worker"]')) return;
    running = true; bootstrap.disconnect(); requestAnimationFrame(tick);
  };
  bootstrap = new MutationObserver(begin);
  bootstrap.observe(document, { childList: true, subtree: true }); begin();
}

export async function novelStation(frame, ratio) {
  await frame.evaluate(ratio => {
    const root = document.querySelector('.lv-scroll');
    // Scaled physical positions are only navigation input. Source-tagged glyphs
    // below are the independently checked result of the seek.
    root.scrollTo({ top: Math.max(0, root.scrollHeight - root.clientHeight) * ratio, behavior: 'instant' });
  }, ratio);
}

export async function novelAnchor(frame, expected) {
  return frame.evaluate(expected => expected ? window.__limrNovelLocate(expected) : window.__limrNovelAnchor(), expected);
}
