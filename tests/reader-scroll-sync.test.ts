import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReaderScrollSync, type ReaderScrollBridge } from '../webview/scroll-sync';

class ScrollRoot extends EventTarget {
  scrollTop = 400;
  scrollHeight = 10000;
  scrollTo({ top }: { top: number }) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')); }
}
let sync: ReaderScrollSync;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('document', { body: new EventTarget() });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => { sync?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps only the latest source location through a slow reader replacement, without polling', () => {
  let reader: ReaderScrollBridge | null = null;
  const restoreReadingPosition = vi.fn(), root = new ScrollRoot();
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, vi.fn(), undefined, () => reader);
  sync.reveal(500); vi.advanceTimersByTime(60_000);
  expect(vi.getTimerCount()).toBe(0);
  sync.reveal(1000); vi.advanceTimersByTime(16);
  reader = { restoreReadingPosition, getReadingPosition: () => null };
  sync.refresh(); vi.advanceTimersByTime(16);
  expect(restoreReadingPosition).toHaveBeenCalledExactlyOnceWith({ source: 1000, offset: 18 });
  expect(vi.getTimerCount()).toBe(0);
});

it('settles at the actual top even when the first text glyph is below the padding', () => {
  const root = new ScrollRoot(), send = vi.fn();
  const restoreReadingPosition = vi.fn(({ offset }: { offset: number }) => { root.scrollTop = Math.max(0, 20 - offset); });
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, send, undefined,
    () => ({ restoreReadingPosition, getReadingPosition: () => ({ source: 0, offset: 20 }) }));
  sync.reveal(0); vi.advanceTimersByTime(16);
  expect(root.scrollTop).toBe(0);
  expect(restoreReadingPosition).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

it('lets a reader gesture cancel a queued source restore', () => {
  const root = new ScrollRoot(), restoreReadingPosition = vi.fn();
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, vi.fn(), undefined,
    () => ({ restoreReadingPosition, getReadingPosition: () => null }));
  sync.reveal(1000); root.dispatchEvent(new Event('wheel')); vi.advanceTimersByTime(16);
  expect(restoreReadingPosition).not.toHaveBeenCalled();
});
