import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderScrollSync } from './scroll-sync';

class Root extends EventTarget {
  scrollTop = 0;
  blockHeight = 100;
  article = { isConnected: true };
  blocks = Array.from({ length: 5 }, (_, index) => ({
    dataset: { sourceStart: String(index * 100), sourceEnd: String(index * 100 + 90) },
    getBoundingClientRect: () => ({ top: index * this.blockHeight - this.scrollTop, bottom: (index + 1) * this.blockHeight - this.scrollTop }),
  }));
  querySelector() { return this.article; }
  querySelectorAll() { return this.blocks; }
  getBoundingClientRect() { return { top: 0 }; }
  scrollTo({ top }: { top: number }) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')); }
}

describe('reader scroll input ownership', () => {
  let body: EventTarget, windowTarget: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers(); body = new EventTarget(); windowTarget = new EventTarget();
    vi.stubGlobal('document', { body }); vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function setup() {
    const root = new Root(), send = vi.fn(), input = vi.fn();
    const sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, send, input);
    return { root, send, input, sync };
  }
  it('rejects in-flight and delayed native echoes throughout a real gesture, including long frame gaps', () => {
    const { root, input, sync } = setup();
    sync.reveal(300);
    root.dispatchEvent(new Event('wheel'));
    root.scrollTop = 120; root.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1000);
    sync.reveal(90); vi.advanceTimersByTime(1000);
    expect(root.scrollTop).toBe(120);
    expect(input.mock.calls).toEqual([[true, 1, 0]]);
    sync.dispose();
  });
  it('hands control back immediately when the pointer enters the native editor', () => {
    const { root, input, sync } = setup();
    root.dispatchEvent(new Event('wheel'));
    body.dispatchEvent(new Event('pointerleave'));
    sync.reveal(200); vi.advanceTimersByTime(16);
    expect(root.scrollTop).toBe(182);
    expect(input.mock.calls).toEqual([[true, 1, 0], [false, 1, 0]]);
    sync.dispose();
  });
  it('accepts explicit native keyboard takeover and does not echo the applied scroll', () => {
    const { root, send, sync } = setup();
    root.dispatchEvent(new Event('wheel'));
    sync.release(); sync.reveal(250); vi.advanceTimersByTime(32);
    expect(root.scrollTop).toBe(232);
    expect(send).not.toHaveBeenCalled();
    sync.dispose();
  });
  it('reads current block geometry after image expansion without rebuilding the source index', () => {
    const { root, send, sync } = setup();
    root.dispatchEvent(new Event('wheel'));
    root.scrollTop = 232; root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(16);
    expect(send).toHaveBeenLastCalledWith(250, 1, 0);
    sync.release();
    root.blockHeight = 200;
    sync.reveal(250); vi.advanceTimersByTime(16);
    expect(root.scrollTop).toBe(482);
    sync.dispose();
  });
  it('releases ownership on focus loss and disposal without leaving event listeners', () => {
    const { root, input, sync } = setup();
    root.dispatchEvent(new Event('wheel')); windowTarget.dispatchEvent(new Event('blur'));
    root.dispatchEvent(new Event('pointerdown')); sync.dispose();
    root.dispatchEvent(new Event('wheel'));
    expect(input.mock.calls).toEqual([[true, 1, 0], [false, 1, 0], [true, 2, 0], [false, 2, 0]]);
  });
  it('cancels queued reader frames and ignores layout/inertia events after source takeover', () => {
    const { root, send, sync } = setup();
    root.dispatchEvent(new Event('wheel')); root.scrollTop = 100; root.dispatchEvent(new Event('scroll'));
    sync.sourceInput(1);
    root.scrollTop = 150; root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(64);
    expect(send).not.toHaveBeenCalled();
    sync.dispose();
  });
  it('does not release a new reader gesture on an old epoch or old source generation', () => {
    const { root, send, sync } = setup();
    root.dispatchEvent(new Event('wheel')); body.dispatchEvent(new Event('pointerleave'));
    root.dispatchEvent(new Event('wheel')); sync.sourceInput(0, 1);
    root.scrollTop = 100; root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(16);
    expect(send).toHaveBeenLastCalledWith(118, 2, 0);
    sync.sourceInput(2); root.dispatchEvent(new Event('wheel')); sync.sourceInput(1); sync.sourceInput(2);
    root.scrollTop = 150; root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(16);
    expect(send).toHaveBeenLastCalledWith(168, 3, 2);
    sync.dispose();
  });
  it('resets ownership and deduplication when synchronized scrolling is toggled', () => {
    const { root, send, input, sync } = setup();
    root.dispatchEvent(new Event('wheel')); root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(16);
    sync.reset();
    root.dispatchEvent(new Event('wheel')); root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(16);
    expect(send.mock.calls).toEqual([[0, 1, 0], [0, 2, 0]]);
    expect(input.mock.calls).toEqual([[true, 1, 0], [false, 1, 0], [true, 2, 0]]);
    sync.dispose();
  });
  it('waits for loading before revealing unmounted source through the public reader bridge', () => {
    // The bridge's explicit readiness notification must suffice without
    // collecting mutations from every virtual mount and typography update.
    vi.stubGlobal('MutationObserver', class { constructor() { throw new Error('Unexpected legacy DOM observer'); } });
    const root = new Root(), send = vi.fn(), restoreReadingPosition = vi.fn();
    let ready = false;
    const bridge = { getReadingPosition: () => ({ source: 4200, offset: -4 }), restoreReadingPosition };
    const sync = new ReaderScrollSync(root as unknown as HTMLElement, () => true, send, () => {}, () => ready ? bridge : null);
    sync.reveal(9000); vi.advanceTimersByTime(1000);
    expect(restoreReadingPosition).not.toHaveBeenCalled();
    ready = true; sync.refresh(); vi.advanceTimersByTime(16);
    expect(restoreReadingPosition).toHaveBeenCalledWith({ source: 9000, offset: 18 });
    expect(send).not.toHaveBeenCalled();
    root.scrollTop = 200; root.dispatchEvent(new Event('wheel')); root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(16);
    expect(send).toHaveBeenLastCalledWith(4200, 1, 0);
    sync.sourceInput(1); sync.reveal(8000); vi.advanceTimersByTime(16);
    expect(restoreReadingPosition).toHaveBeenLastCalledWith({ source: 8000, offset: 18 });
    sync.dispose();
  });
});
