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

it('follows each received source location when a newer source generation arrives before its animation frame', () => {
  const root = new ScrollRoot(), restoreReadingPosition = vi.fn(), send = vi.fn();
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, send, undefined,
    () => ({ restoreReadingPosition, getReadingPosition: () => null }));
  // Observed CMOS sequence: source ranges advance every ~32 ms, while the
  // next range's ownership message can follow the preceding reveal by 0–2 ms.
  // The old implementation dropped all three intermediate locations.
  sync.sourceInput(675); sync.reveal(13101);
  vi.advanceTimersByTime(2); sync.sourceInput(676); vi.advanceTimersByTime(14);
  expect(restoreReadingPosition.mock.calls.map(([position]) => position.source)).toEqual([13101]);
  for (const [source, generation] of [[13244, 677], [13304, 678]]) {
    vi.advanceTimersByTime(16); sync.reveal(source); sync.sourceInput(generation); vi.advanceTimersByTime(16);
  }
  expect(restoreReadingPosition.mock.calls.map(([position]) => position.source)).toEqual([13101, 13244, 13304]);
  expect(send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('coalesces source updates into the existing frame without postponing it on each generation', () => {
  const root = new ScrollRoot(), restoreReadingPosition = vi.fn();
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, vi.fn(), undefined,
    () => ({ restoreReadingPosition, getReadingPosition: () => null }));
  sync.sourceInput(1); sync.reveal(1000);
  vi.advanceTimersByTime(8); sync.sourceInput(2); sync.reveal(2000);
  vi.advanceTimersByTime(8);
  expect(restoreReadingPosition).toHaveBeenCalledExactlyOnceWith({ source: 2000, offset: 18 });
  expect(vi.getTimerCount()).toBe(0);
});

it('invalidates old reader output on source takeover while ignoring stale generations and epochs', () => {
  const root = new ScrollRoot(), send = vi.fn(), inputChanged = vi.fn();
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, send, inputChanged,
    () => ({ restoreReadingPosition: vi.fn(), getReadingPosition: () => ({ source: 900, offset: 18 }) }));
  sync.sourceInput(5); root.dispatchEvent(new Event('wheel')); root.scrollTo({ top: 450 });
  sync.sourceInput(4, 1); sync.sourceInput(5, 0); vi.advanceTimersByTime(16);
  expect(send).toHaveBeenCalledExactlyOnceWith(900, 1, 5);
  send.mockClear(); root.scrollTo({ top: 500 }); sync.sourceInput(6); vi.advanceTimersByTime(16);
  expect(send).not.toHaveBeenCalled();
  root.dispatchEvent(new Event('wheel')); root.scrollTo({ top: 550 }); vi.advanceTimersByTime(16);
  expect(send).toHaveBeenCalledExactlyOnceWith(900, 2, 6);
  expect(inputChanged.mock.calls).toEqual([[true, 1, 5], [true, 2, 6]]);
});

it('still gives a new reader gesture priority over a source restore preserved across generations', () => {
  const root = new ScrollRoot(), restoreReadingPosition = vi.fn(), send = vi.fn();
  sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, send, undefined,
    () => ({ restoreReadingPosition, getReadingPosition: () => ({ source: 900, offset: 18 }) }));
  sync.sourceInput(1); sync.reveal(1000); sync.sourceInput(2);
  root.dispatchEvent(new Event('wheel')); vi.advanceTimersByTime(16);
  expect(restoreReadingPosition).not.toHaveBeenCalled();
  root.scrollTo({ top: 450 }); vi.advanceTimersByTime(16);
  expect(send).toHaveBeenLastCalledWith(900, 1, 2);
});
