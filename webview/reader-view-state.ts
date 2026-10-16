import { useLayoutEffect } from 'react';
import { readWebviewState, saveWebviewState } from './bridge';

/** VS Code recreates the webview guest when an add-on's resource grants change. */
export function useReaderViewState(root: HTMLElement | null, uri: string | undefined) {
  useLayoutEffect(() => root && uri ? preserveReaderViewState(root, uri) : undefined, [root, uri]);
}

export function preserveReaderViewState(root: HTMLElement, uri: string) {
  const previous = readWebviewState();
  const stored = previous && typeof previous === 'object' && 'limrReaderPosition' in previous
    ? previous.limrReaderPosition as { uri?: string; top?: number } : undefined;
  const target = stored?.uri === uri && Number.isFinite(stored.top) ? Math.max(0, stored.top!) : 0;
  let restoring = target > 0, frame = 0, deadline: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined;
  const save = () => {
    clearTimeout(timer); timer = undefined;
    // Hidden guests report an empty viewport; keep the last meaningful position.
    if (!root.clientHeight || !root.scrollHeight) return;
    const state = readWebviewState();
    saveWebviewState({ ...(state && typeof state === 'object' ? state : {}), limrReaderPosition: { uri, top: root.scrollTop } });
  };
  const restore = () => {
    frame = 0;
    if (!restoring) return;
    // A hidden reader resumes on its next visible layout without polling forever.
    if (!root.clientHeight) { deadline = undefined; return; }
    deadline ??= performance.now() + 2000;
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    // Measuring layout starts bundled font loads. Restoring before those settle
    // lets browser scroll anchoring accumulate small offsets on each guest reload.
    if (typeof document !== 'undefined' && document.fonts?.status === 'loading' && performance.now() < deadline) {
      frame = requestAnimationFrame(restore); return;
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
  const receive = (event: MessageEvent) => { if (event.data?.type === 'reveal') interrupt(); };
  const unload = () => { if (!restoring) save(); };
  const inputEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown'];
  root.addEventListener('scroll', scroll, { passive: true });
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
    for (const event of inputEvents) root.removeEventListener(event, interrupt);
    window.removeEventListener('beforeunload', unload);
    window.removeEventListener('message', receive);
    if (!restoring) save();
  };
}
