/** Installed before the reader Webview is created. Only observations are added;
 * source, parser options, DOM layout and production renderer code are untouched. */
export function installObservers() {
  const state = window.__limrReadingBench = { messages: [], workers: [], tasks: [], errors: [], resources: [], started: performance.now() };
  const ready = new MutationObserver(() => {
    if (state.readyAt === undefined && state.messages.some(message => message.type === 'state')
      && document.querySelector('.lv-app[data-reader-ready="true"]') && !document.querySelector('.limr-document-loading')) {
      state.readyAt = performance.now(); ready.disconnect();
    }
  });
  const onMessage = event => {
    const message = event.data;
    if (message?.type === 'state') state.messages.push({ at: performance.now(), type: 'state', chars: message.sourceCharacters ?? message.state?.document?.source?.length, transport: message.sourceBytes instanceof ArrayBuffer ? "binary" : "json", version: message.state?.document?.version, settings: message.state?.settings });
    else if (message?.type === 'configuration') state.messages.push({ at: performance.now(), type: message.type, settings: message.configuration?.settings });
    else if (message?.type === 'reveal' || message?.type === 'scrollIntent') state.messages.push({ at: performance.now(), type: message.type,
      offset: message.offset, generation: message.generation, epoch: message.epoch, active: message.active,
      rootPresent: !!document.querySelector('.lv-scroll'), complete: document.querySelector('.lv-app')?.dataset.readerReady === 'true' });
  };
  const onError = event => state.errors.push({ at: performance.now(), message: event.message ?? 'resource error', url: event.target?.src ?? event.filename, stack: event.error?.stack });
  const onRejection = event => state.errors.push({ at: performance.now(), message: String(event.reason), stack: event.reason?.stack });
  const attach = () => {
    removeEventListener('message', onMessage); removeEventListener('error', onError, true); removeEventListener('unhandledrejection', onRejection);
    addEventListener('message', onMessage); addEventListener('error', onError, true); addEventListener('unhandledrejection', onRejection);
    ready.disconnect(); ready.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-reader-ready'] });
  };
  attach();
  // VS Code calls open/write/close on the inner frame. open removes Window
  // event listeners after Playwright's init script, before the actual module.
  // Reattach only our observers; preserve native arguments, return and timing.
  const nativeOpen = Document.prototype.open;
  Document.prototype.open = function (...args) {
    const result = Reflect.apply(nativeOpen, this, args);
    if (this === document) { state.documentReopens = (state.documentReopens ?? 0) + 1; attach(); }
    return result;
  };
  try { new PerformanceObserver(list => state.tasks.push(...list.getEntries().map(task => ({ start: task.startTime, duration: task.duration })))).observe({ type: 'longtask', buffered: true }); } catch { /* Recorded browser may not expose long tasks. */ }
  const NativeWorker = window.Worker;
  window.Worker = class ObservedWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      const worker = { url: String(args[0]), created: performance.now(), requests: [], responses: [] };
      state.workers.push(worker); this.__bench = worker;
      this.addEventListener('message', event => {
        const data = event.data;
        worker.responses.push({ at: performance.now(), type: data?.type, revision: data?.revision, complete: data?.complete,
          progressive: data?.progressive, chars: data?.snapshot?.source?.length ?? data?.sourceLength,
          blocks: data?.snapshot?.blocks?.length ?? data?.blockCount, progress: data?.progress, error: data?.type === 'error' ? data.message : undefined });
      });
      this.addEventListener('error', event => state.errors.push({ at: performance.now(), message: event.message, worker: worker.url }));
    }
    postMessage(message, ...rest) {
      const request = message?.type === 'load' ? { at: performance.now(), revision: message.revision, mode: message.mode,
        chars: typeof message.input === 'string' ? message.input.length : undefined, extensions: message.extensions } : undefined;
      if (request) this.__bench.requests.push(request);
      const result = super.postMessage(message, ...rest);
      if (request) { request.returnedAt = performance.now(); request.postMessageMs = request.returnedAt - request.at; }
      return result;
    }
  };
}

export const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null, p95: sorted[Math.floor(sorted.length * .95)] ?? null,
    max: sorted.at(-1) ?? null, over50: sorted.filter(value => value > 50).length, invalid: sorted.filter(value => !Number.isFinite(value) || value < 0).length };
};

export async function installGeometry(frame) {
  await frame.evaluate(() => {
    window.__limrGeometry = () => {
      const root = document.querySelector('.lv-scroll'), article = root?.querySelector('.limr-reader-content > article');
      if (!root || !article) return { ready: false };
      const viewport = root.getBoundingClientRect(), top = Math.max(0, viewport.top), bottom = Math.min(innerHeight, viewport.bottom);
      const visible = element => { const box = element.getBoundingClientRect(); return box.height > 0 && box.bottom > top && box.top < bottom && !element.closest('[inert],[data-window-parked]'); };
      const slots = [...article.querySelectorAll('[data-window-slot]:not([data-window-parked])')].map(element => ({ index: Number(element.dataset.windowSlot), box: element.getBoundingClientRect() })).sort((a, b) => a.index - b.index);
      const gaps = [];
      for (let index = 1; index < slots.length; index++) {
        const previous = slots[index - 1], next = slots[index];
        if (next.index === previous.index + 1 && previous.box.bottom >= top && next.box.top <= bottom) gaps.push({ from: previous.index, to: next.index, px: next.box.top - previous.box.bottom });
      }
      const content = [...article.querySelectorAll('[data-limr-block]')].filter(visible);
      const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
      const paragraphs = [...article.querySelectorAll('p,li')].filter(visible);
      const box = article.getBoundingClientRect();
      const coverage = [.2, .5, .8].map(ratio => document.elementsFromPoint(box.x + box.width / 2, top + (bottom - top) * ratio).some(element => {
        const block = element.closest('[data-limr-block]');
        return block && article.contains(block) && !block.closest('[inert],[data-window-parked]') && (!!block.textContent.trim() || !!block.querySelector('img,svg'));
      }));
      return { ready: true, scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, viewport: { top, bottom, width: viewport.width }, contentWidth: box.width,
        windowed: !!article.querySelector('[data-limr-windowed]'), mountedSlots: slots.length, gaps,
        mountedBlocks: article.querySelectorAll('[data-limr-block]').length,
        visibleSources: content.map(element => ({ start: Number(element.dataset.sourceStart), end: Number(element.dataset.sourceEnd) })).filter(range => Number.isFinite(range.start) && Number.isFinite(range.end)),
        visibleBlocks: content.length, coverage, visibleStaleKP: paragraphs.filter(element => element.hasAttribute('data-limr-kp-stale')).length,
        heading: headings[0] ? { text: headings[0].textContent, top: headings[0].getBoundingClientRect().top, start: headings[0].dataset.sourceStart } : null,
        signature: paragraphs.map(element => { const r = element.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(value => value.toFixed(1)).join(',') + ':' + (element.dataset.limrKp ?? '') + ':' + element.querySelectorAll('[data-limr-kp-run],.limr-kp-glue').length; }).join('|'),
      };
    };
  });
}

export async function waitStable(frame, minimum = 200) {
  return frame.evaluate(async minimum => {
    const start = performance.now(), frames = []; let previous = start, changed = start, signature;
    for (;;) {
      await new Promise(requestAnimationFrame);
      const now = performance.now(); frames.push(now - previous); previous = now;
      const geometry = window.__limrGeometry();
      if (geometry.signature !== signature) { signature = geometry.signature; changed = now; }
      if (now - start >= minimum && now - changed >= 150 && geometry.visibleBlocks && !geometry.visibleStaleKP || now - start > 6000)
        return { frames, ms: now - start, timeout: now - start > 6000, geometry };
    }
  }, minimum);
}

export async function scrollProbe(frame, kind) {
  return frame.evaluate(async kind => {
    const root = document.querySelector('.lv-scroll'), start = performance.now(), frames = [], geometry = [];
    let previous = start, steps = 0;
    while (kind === 'steady' ? performance.now() - start < 3000 : steps < 120) {
      await new Promise(requestAnimationFrame);
      const now = performance.now(), elapsed = now - previous; frames.push(elapsed); previous = now;
      if (steps % 12 === 0) geometry.push({ at: now, ...window.__limrGeometry() });
      const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
      const next = kind === 'steady' ? root.scrollTop + 480 * elapsed / 1000 : kind === 'fast' ? root.scrollTop + 120
        : (steps < 60 ? steps / 60 : (120 - steps) / 60) * maximum;
      root.scrollTo({ top: next, behavior: 'instant' }); steps++;
    }
    return { kind, start, frames, geometry, longtasks: window.__limrReadingBench.tasks.filter(task => task.start >= start) };
  }, kind);
}

export async function prepareTranslation(frame) {
  // Never click overscan content. Search advances are setup, not scroll samples.
  for (let step = 0; step < 12; step++) {
    const found = await frame.evaluate(() => {
      const root = document.querySelector('.lv-scroll'), viewport = root.getBoundingClientRect();
      const buttons = [...root.querySelectorAll('[data-translation-switch]')].filter(button => !button.disabled && !button.closest('[inert],[data-window-parked]'));
      const visible = buttons.find(button => { const r = button.getBoundingClientRect(); return r.width > 0 && r.top >= Math.max(viewport.top, 0) && r.bottom <= Math.min(viewport.bottom, innerHeight); });
      if (visible) return true;
      root.scrollBy({ top: root.clientHeight * .65, behavior: 'instant' }); return false;
    });
    if (found) return true;
    await frame.waitForTimeout(250);
  }
  return false;
}

export async function translationProbe(frame, scrolling) {
  return frame.evaluate(async scrolling => {
    const root = document.querySelector('.lv-scroll'), viewport = root.getBoundingClientRect();
    const button = [...root.querySelectorAll('[data-translation-switch]')].find(button => {
      const r = button.getBoundingClientRect(); return !button.disabled && !button.closest('[inert],[data-window-parked]') && r.width > 0 && r.top >= Math.max(0, viewport.top) && r.bottom <= Math.min(innerHeight, viewport.bottom);
    });
    if (!button) throw new Error('No translation switch fully inside the reader viewport.');
    const block = button.closest('.limr-translations'), before = block.dataset.mode, buttonRect = button.getBoundingClientRect().toJSON();
    const start = performance.now(), frames = [], geometry = []; let previous = start, committed = null;
    const observer = new MutationObserver(() => { if (committed === null && block.dataset.mode !== before) committed = performance.now() - start; });
    observer.observe(block, { attributes: true, attributeFilter: ['data-mode'] }); button.click();
    while (performance.now() - start < 850) {
      await new Promise(requestAnimationFrame);
      const now = performance.now(), elapsed = now - previous; frames.push(elapsed); previous = now;
      if (frames.length % 12 === 0) geometry.push(window.__limrGeometry());
      if (scrolling) root.scrollBy({ top: 480 * elapsed / 1000, behavior: 'instant' });
    }
    observer.disconnect();
    return { start, frames, geometry, scrolling, before, after: block.dataset.mode, modeChanged: block.dataset.mode !== before, committed, buttonRect,
      longtasks: window.__limrReadingBench.tasks.filter(task => task.start >= start) };
  }, scrolling);
}

export async function resizeProbe(frame, change, target) {
  await frame.evaluate(() => {
    const state = window.__limrResize = { start: performance.now(), frames: [], running: true }; let last = state.start;
    const tick = () => { if (!state.running) return; const now = performance.now(); state.frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await change();
  const settled = await waitStable(frame, 250);
  return { target, settled, ...await frame.evaluate(() => {
    const state = window.__limrResize; state.running = false;
    return { start: state.start, frames: state.frames, ms: performance.now() - state.start, longtasks: window.__limrReadingBench.tasks.filter(task => task.start >= state.start) };
  }) };
}
