import { createHash } from 'node:crypto';
import { typographyCompatibilityModules } from './limr-typography.mjs';
import { captureFallbackCorrection } from './limr-source-position.mjs';

// Reviewed compatibility corrections for the published LiMR 1.3.10 reader.
// Keep the rendering logic in core: adapt its module at build time, without
// changing node_modules or copying a renderer into the VS Code webview.
// Remove this adapter when a reviewed upstream release contains these fixes.
// The earlier DOM-translation/MutationObserver compensation is intentionally
// removed: it let our own window commits recursively drive viewport correction.
//
// 1. Refine already-mounted source targets without an estimated intermediate jump.
// 2. Map invisible closing markup forward, instead of back to a figure/block top.
// 3. Reader-gutter wheel input cancels pending virtual navigation too.
// 4. Anchor source refinement in the measured block index, bound nested commits,
//    and wait for measurable restored viewports.
// 5. Measure resized slots and publish their scroll correction before paint,
//    instead of exposing the changed flow for a frame before the next RAF.
const reviewedVersion = '1.3.10';
const reviewedSHA256 = "8a6c4cfae656ac4aade2453da0189c2e26b6722fc0f228acf0208ac145703a56";
const replacements = [
  [
`  const source = Number(block.element.dataset.sourceStart);
  return Number.isFinite(source) ? { source, offset: block.rect.top - viewport } : null;
}
function restoreReadingPosition(runtime, position) {
  if (!Number.isFinite(position.source) || !Number.isFinite(position.offset)) return;
  const snapshot = runtime.document.getSnapshot();
`,
`  const source = Number(block.element.dataset.sourceStart);
  return Number.isFinite(source) ? { source, offset: block.rect.top - viewport } : null;
}
function __limrSourcePositionTop(runtime, range, block, node) {
  const exact = sourceRangeStartRect(runtime, range);
  if (exact) return exact.top;
  const following = sourceRangeStartRect(runtime, { start: Math.max(range.start, block.range.start), end: block.range.end });
  if (following) return following.top;
  const bounds = node.getBoundingClientRect();
  return range.start > block.range.start && sourceRangeStartRect(runtime, block.range) ? bounds.bottom : bounds.top;
}
function restoreReadingPosition(runtime, position) {
  if (!Number.isFinite(position.source) || !Number.isFinite(position.offset)) return;
  const snapshot = runtime.document.getSnapshot();
`
  ],
  [
`    const positions = new Map(entries.map((block, index) => [block.id, index]));
    let geometry = readingScrollGeometry(heights.total, viewportHeight()), frame = 0, pendingMeasure = false, disposed = false, logical = 0, origin = 0, translating = false;
    let measuredTypography = typographyLayoutVersion(runtime);
    let requested, printing = false, touch;
    let navigationFrame = 0;
    const request = (next) => {
`,
`    const positions = new Map(entries.map((block, index) => [block.id, index]));
    let geometry = readingScrollGeometry(heights.total, viewportHeight()), frame = 0, pendingMeasure = false, disposed = false, logical = 0, origin = 0, translating = false;
    let measuredTypography = typographyLayoutVersion(runtime);
    let committedMeasurements = 0, measurementResetFrame = 0;
    let requested, printing = false, touch;
    let navigationFrame = 0;
    const request = (next) => {
`
  ],
  [
`    const refresh = (measure) => {
      frame = 0;
      if (disposed || printing) return;
      if (translating) queue2();
`,
`    const refresh = (measure) => {
      frame = 0;
      // Restored/hidden webviews temporarily have no layout. Do not replace
      // measured heights with zero or seek against that empty geometry.
      // ResizeObserver resumes the pending request when the viewport returns.
      if (disposed || printing || !element.clientWidth || !viewportHeight()) return;
      if (translating) queue2();
`
  ],
  [
`    const committed = () => {
      if (disposed) return;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      const next = /* @__PURE__ */ new Set([element, content, ...content.querySelectorAll(":scope > [data-window-slot]")]);
`,
`    const committed = () => {
      if (disposed) return;
      const next = /* @__PURE__ */ new Set([element, content, ...config.scrollRoot ? [config.scrollRoot] : [], ...content.querySelectorAll(":scope > [data-window-slot]")]);
`
  ],
  [
`      pendingMeasure = false;
      refresh(true);
    };
    measureCommitted.current = committed;
`,
`      // Every committed window must be measured before paint: newly mounted
      // prefix blocks still use estimates in the height index, while the DOM
      // already uses their actual heights. Deferring this measurement exposes
      // that discrepancy and then visibly corrects it on the next frame.
      // Bound publication of the NEXT window in commit(), after this window's
      // measurements and scroll correction have completed.
      if (!measurementResetFrame) measurementResetFrame = requestAnimationFrame(() => {
        measurementResetFrame = 0;
        committedMeasurements = 0;
      });
      ++committedMeasurements;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      pendingMeasure = false;
      refresh(true);
    };
    measureCommitted.current = committed;
`
  ],
  [
`            queue2();
            return;
          }
          const target = (sourceRangeStartRect(runtime, requested.range)?.top ?? node.getBoundingClientRect().top) - viewportTop() - requested.offset;
          const pendingTypography = sourceTypographyPending(runtime, node, requested.range, content);
          if (Math.abs(target) > 1) {
            const outside = current - Math.max(origin, Math.min(origin + geometry.physicalMax, current));
            if (!move(logical + outside + target, true) && !pendingTypography) {
`,
`            queue2();
            return;
          }
          const target = __limrSourcePositionTop(runtime, requested.range, block, node) - viewportTop() - requested.offset;
          const pendingTypography = sourceTypographyPending(runtime, node, requested.range, content);
          if (Math.abs(target) > 1) {
            // A window commit can change its origin, and logical is clamped at
            // both ends. Feeding the DOM error back into that coordinate can
            // alternate windows forever. Locate the source inside its measured
            // slot instead; the same layout now produces the same destination.
            const slot = node.closest("[data-window-slot]");
            const next = slot
              ? heights.offset(index) + runtime.getContentOffset() + target + viewportTop() - slot.getBoundingClientRect().top
              : logical + current - Math.max(origin, Math.min(origin + geometry.physicalMax, current)) + target;
            if (!move(next, true) && !pendingTypography) {
`
  ],
  [
`        const interaction = runtime.interaction.get();
        if (!interaction.active && !interaction.hovered) runtime.documentOffset.set(0);
        refineAfterCommit.current = true;
        move(heights.offset(sourceIndex(range.start)));
        schedule();
      },
      activeHeading() {
`,
`        const interaction = runtime.interaction.get();
        if (!interaction.active && !interaction.hovered) runtime.documentOffset.set(0);
        refineAfterCommit.current = true;
        if (!element.clientWidth || !viewportHeight()) {
          schedule();
          return;
        }
        const index = sourceIndex(range.start);
        const node = entries[index] && runtime.blocks.get(entries[index].id);
        if (node && !node.closest("[inert],[data-window-parked]") && index >= committedView.current.start && index < committedView.current.end) refresh(false);
        else move(heights.offset(index));
        schedule();
      },
      activeHeading() {
`
  ],
  [
`    };
    runtime.documentViewport = viewport;
    const insideScroller = (target) => {
      for (let node = target instanceof Element ? target : null; node && node !== element; node = node.parentElement) {
        if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return true;
      }
      return false;
    };
    const wheel = (event) => {
      if (!event.defaultPrevented && !event.ctrlKey && !event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX) && event.deltaY && !insideScroller(event.target)) {
        request();
        bottomAnchor = void 0;
        readingAnchor = void 0;
      }
      if (geometry.scale <= 1 || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.defaultPrevented || insideScroller(event.target) || !event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? line : event.deltaMode === 2 ? viewportHeight() : 1);
      if (logical <= 0 && delta < 0 || logical >= geometry.logicalMax && delta > 0) return;
`,
`    };
    runtime.documentViewport = viewport;
    const insideScroller = (target) => {
      for (let node = target instanceof Element ? target : null; node && node !== element && node !== config.scrollRoot; node = node.parentElement) {
        if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) return true;
      }
      return false;
    };
    const cancelNavigationWheel = (event) => {
      if (!event.defaultPrevented && !event.ctrlKey && !event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX) && event.deltaY && !insideScroller(event.target)) {
        request();
        bottomAnchor = void 0;
        readingAnchor = void 0;
      }
    };
    const wheel = (event) => {
      if (geometry.scale <= 1 || event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.defaultPrevented || insideScroller(event.target) || !event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? line : event.deltaMode === 2 ? viewportHeight() : 1);
      if (logical <= 0 && delta < 0 || logical >= geometry.logicalMax && delta > 0) return;
`
  ],
  [
`    };
    const observed = /* @__PURE__ */ new Set([content, element]);
    const resize = new ResizeObserver(() => {
      if (!disposed) schedule();
    });
    resize.observe(content);
    resize.observe(element);
`,
`    };
    const observed = /* @__PURE__ */ new Set([content, element, ...config.scrollRoot ? [config.scrollRoot] : []]);
    const resize = new ResizeObserver(() => {
      if (disposed) return;
      // ResizeObserver runs before paint, outside React's commit. A deferred
      // measurement lets changed preceding paragraphs move the visible text
      // for one frame before compensating. Measure and apply core's existing
      // scroll correction in this delivery, without another anchor. Leave
      // React's window commit to its scheduler: forcing that commit here can
      // resize an observed ancestor and violate the observer depth ordering.
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pendingMeasure = false;
      refresh(true);
    });
    for (const target of observed) resize.observe(target);
`
  ],
  [
`    element.ownerDocument.addEventListener("pointerdown", claim, true);
    element.ownerDocument.addEventListener("focusin", scroll);
    scrollRoot.addEventListener("scroll", scroll, { passive: true });
    element.addEventListener("wheel", wheel, { passive: false });
    element.ownerDocument.addEventListener("keydown", key2);
    element.addEventListener("touchstart", touchStart, { passive: true });
`,
`    element.ownerDocument.addEventListener("pointerdown", claim, true);
    element.ownerDocument.addEventListener("focusin", scroll);
    scrollRoot.addEventListener("scroll", scroll, { passive: true });
    scrollRoot.addEventListener("wheel", cancelNavigationWheel, { capture: true, passive: true });
    element.addEventListener("wheel", wheel, { passive: false });
    element.ownerDocument.addEventListener("keydown", key2);
    element.addEventListener("touchstart", touchStart, { passive: true });
`
  ],
  [
`      prose?.removeEventListener("transitionend", translation);
      prose?.removeEventListener("transitioncancel", translation);
      disposed = true;
      if (measureCommitted.current === committed) measureCommitted.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
`,
`      prose?.removeEventListener("transitionend", translation);
      prose?.removeEventListener("transitioncancel", translation);
      disposed = true;
      if (measureCommitted.current === committed) measureCommitted.current = null;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measurementResetFrame);
      resize.disconnect();
`
  ],
  [
`      if (captureCommitted.current === rememberPosition) captureCommitted.current = null;
      if (runtime.documentViewport === viewport) runtime.documentViewport = null;
      scrollRoot.removeEventListener("scroll", scroll);
      element.removeEventListener("wheel", wheel);
      element.ownerDocument.removeEventListener("keydown", key2);
      element.removeEventListener("touchstart", touchStart);
`,
`      if (captureCommitted.current === rememberPosition) captureCommitted.current = null;
      if (runtime.documentViewport === viewport) runtime.documentViewport = null;
      scrollRoot.removeEventListener("scroll", scroll);
      scrollRoot.removeEventListener("wheel", cancelNavigationWheel, true);
      element.removeEventListener("wheel", wheel);
      element.ownerDocument.removeEventListener("keydown", key2);
      element.removeEventListener("touchstart", touchStart);
`
  ],
  [
`        latest.current = next;
        setView(next);`,
`        // A cold window can need several expanding overscan measurements.
        // Allow it to converge, but stop below React's nested-update limit for
        // pathological zero-height/custom blocks or a repeating source seek.
        // Keep the measured DOM mounted while yielding its successor. Earlier
        // parked blocks or a width change can also move this window's prefix;
        // publish its matching geometry along with the scroll correction.
        if (committedMeasurements >= 16) {
          schedule();
          const retained = { ...old, top: physical + heights.offset(old.start) - logical,
            height: next.height, printing: next.printing,
            slots: old.slots.map(({ index }) => ({ index,
              top: index >= old.start && index < old.end ? physical + heights.offset(index) - logical : -1e6 })) };
          if (Math.abs(old.top - retained.top) <= 0.1 && Math.abs(old.height - retained.height) <= 0.1 && old.printing === retained.printing) return false;
          latest.current = retained;
          setView(retained);
          return true;
        }
        latest.current = next;
        setView(next);`
  ]
];

export function scrollCompatibilityModules(files, version) {
  if (version !== reviewedVersion) throw new Error(`Review the LiMR scroll adapter before using version ${version}.`);
  const targets = files.filter(file => file.source.includes('function WindowedBlocks('));
  if (targets.length !== 1) throw new Error('LiMR scroll adapter expected exactly one windowed reader module.');
  const { filename, source } = targets[0];
  if (createHash('sha256').update(source).digest('hex') !== reviewedSHA256) {
    throw new Error('LiMR 1.3.10 windowed reader differs from the reviewed npm artifact; review the scroll adapter.');
  }
  let result = source;
  for (const [before, after] of [captureFallbackCorrection(source), ...replacements]) {
    if (result.split(before).length !== 2) throw new Error('LiMR scroll adapter expected exactly one copy of each reviewed source site.');
    result = result.replace(before, after);
  }
  return new Map([[filename, result], ...typographyCompatibilityModules(files, version)]);
}
