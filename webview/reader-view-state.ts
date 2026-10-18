import { useLayoutEffect, useRef, type RefObject } from 'react';
import { readWebviewState, saveWebviewState } from './bridge';
import type { ReaderScrollBridge } from './scroll-sync';

/** VS Code recreates the webview guest when an add-on's resource grants change. */
export function useReaderViewState(root: HTMLElement | null, uri: string | undefined, ready = true, reader?: RefObject<ReaderScrollBridge | null>) {
  // Loading has no meaningful scroll geometry and must never overwrite a saved
  // bookmark, even when a worker takes longer than the old two-second deadline.
  const readiness = useRef(ready); readiness.current = ready;
  useLayoutEffect(() => root && uri ? preserveReaderViewState(root, uri, reader ? () => reader.current : undefined, () => readiness.current) : undefined, [root, uri, reader]);
  useLayoutEffect(() => { if (ready) root?.dispatchEvent(new Event('limr-reader-ready')); }, [root, ready]);
}

export function preserveReaderViewState(root: HTMLElement, uri: string, getReader?: () => ReaderScrollBridge | null, isReady: () => boolean = () => true) {
  const previous = readWebviewState();
  const stored = previous && typeof previous === 'object' && 'limrReaderPosition' in previous
    ? previous.limrReaderPosition as { uri?: string; top?: number; reading?: { source: number; offset: number } } : undefined;
  const target = stored?.uri === uri && Number.isFinite(stored.top) ? Math.max(0, stored.top!) : 0;
  const reading = stored?.uri === uri && stored.reading && Number.isFinite(stored.reading.source) && Number.isFinite(stored.reading.offset) ? stored.reading : undefined;
  let restoring = target > 0 || !!reading, frame = 0, deadline: number | undefined, settleFrames = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined;
  const save = () => {
    clearTimeout(timer); timer = undefined;
    // Hidden guests report an empty viewport; keep the last meaningful position.
    if (!isReady() || !root.clientHeight || !root.scrollHeight) return;
    const state = readWebviewState();
    const position = getReader?.()?.getReadingPosition();
    saveWebviewState({ ...(state && typeof state === 'object' ? state : {}), limrReaderPosition: { uri, top: root.scrollTop, ...(position ? { reading: position } : {}) } });
  };
  const restore = () => {
    frame = 0;
    if (!restoring || !isReady()) return;
    // A hidden reader resumes on its next visible layout without polling forever.
    if (!root.clientHeight) { deadline = undefined; return; }
    deadline ??= performance.now() + 2000;
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    // Measuring layout starts bundled font loads. Restoring before those settle
    // lets browser scroll anchoring accumulate small offsets on each guest reload.
    if (typeof document !== 'undefined' && document.fonts?.status === 'loading' && performance.now() < deadline) {
      frame = requestAnimationFrame(restore); return;
    }
    const reader = getReader?.();
    if (reading && reader) {
      if (!settleFrames) reader.restoreReadingPosition(reading);
      // A windowed reveal mounts its target and refines its source geometry in
      // subsequent frames. Do not persist its temporary estimated scrollTop.
      if (++settleFrames <= 3) { frame = requestAnimationFrame(restore); return; }
      restoring = false; observer?.disconnect(); save(); return;
    }
    root.scrollTo({ top: Math.min(target, maximum), behavior: 'instant' });
    if (maximum >= target || performance.now() >= deadline) {
      restoring = false; observer?.disconnect(); save();
    } else frame = requestAnimationFrame(restore);
  };
  const scroll = () => {
    if (restoring || timer) return;
    timer = setTimeout(save, 80);
  };
  const interrupt = () => { restoring = false; cancelAnimationFrame(frame); frame = 0; observer?.disconnect(); };
  const ready = () => { if (restoring && !frame) frame = requestAnimationFrame(restore); else if (!restoring) save(); };
  const receive = (event: MessageEvent) => { if (event.data?.type === 'reveal' || event.data?.type === 'navigateTo') interrupt(); };
  const unload = () => { if (!restoring) save(); };
  const inputEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown'];
  root.addEventListener('scroll', scroll, { passive: true });
  root.addEventListener('limr-reader-ready', ready);
  for (const event of inputEvents) root.addEventListener(event, interrupt, { passive: true });
  window.addEventListener('beforeunload', unload);
  window.addEventListener('message', receive);
  if (restoring) {
    observer = new ResizeObserver(() => { if (restoring && root.clientHeight && !frame) frame = requestAnimationFrame(restore); });
    observer.observe(root);
    frame = requestAnimationFrame(restore);
  }
  return () => {
    cancelAnimationFrame(frame); clearTimeout(timer); observer?.disconnect();
    root.removeEventListener('scroll', scroll);
    root.removeEventListener('limr-reader-ready', ready);
    for (const event of inputEvents) root.removeEventListener(event, interrupt);
    window.removeEventListener('beforeunload', unload);
    window.removeEventListener('message', receive);
    if (!restoring) save();
  };
}
