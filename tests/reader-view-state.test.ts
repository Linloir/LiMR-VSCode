import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ value: undefined as any, save: vi.fn() }));
vi.mock('../webview/bridge', () => ({ readWebviewState: () => state.value, saveWebviewState: (value: unknown) => { state.value = value; state.save(value); } }));
import { preserveReaderViewState } from '../webview/reader-view-state';

class ScrollRoot extends EventTarget {
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 600;
  scrollTo({ top }: { top: number }) { this.scrollTop = top; this.dispatchEvent(new Event('scroll')); }
}
let dispose: (() => void) | undefined;
let resize: (() => void) | undefined;
const start = (root: ScrollRoot, uri = 'file:///reading.md') => { dispose = preserveReaderViewState(root as unknown as HTMLElement, uri); };
beforeEach(() => {
  vi.useFakeTimers(); state.save.mockClear();
  state.value = { otherFeature: 'preserved', limrReaderPosition: { uri: 'file:///reading.md', top: 900 } };
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() { resize = undefined; } });
});
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('reader position across webview resource-grant reloads', () => {
  it('preserves the previous position while the new reader has not laid out, then restores it', () => {
    const root = new ScrollRoot(); start(root);
    vi.advanceTimersByTime(160);
    window.dispatchEvent(new Event('beforeunload'));
    expect(state.save).not.toHaveBeenCalled(); expect(state.value.limrReaderPosition.top).toBe(900);
    root.scrollHeight = 4000; vi.advanceTimersByTime(16);
    expect(root.scrollTop).toBe(900);
    expect(state.value).toEqual({ otherFeature: 'preserved', limrReaderPosition: { uri: 'file:///reading.md', top: 900 } });
  });
  it('bounds restoration when the updated document is shorter and cleans up its frames', () => {
    const root = new ScrollRoot(); root.scrollHeight = 800; start(root);
    vi.advanceTimersByTime(2200);
    expect(state.value.limrReaderPosition.top).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for pending fonts within the existing deadline before restoring layout', () => {
    const fonts = { status: 'loading' }; vi.stubGlobal('document', { fonts });
    const root = new ScrollRoot(); root.scrollHeight = 4000; start(root);
    vi.advanceTimersByTime(160); expect(root.scrollTop).toBe(0); expect(state.save).not.toHaveBeenCalled();
    fonts.status = 'loaded'; vi.advanceTimersByTime(16); expect(root.scrollTop).toBe(900);
  });
  it('lets new user input cancel a pending restoration and persist the actual position', () => {
    const root = new ScrollRoot(); start(root); vi.advanceTimersByTime(32);
    root.scrollHeight = 700;
    root.dispatchEvent(new Event('wheel'));
    root.scrollTop = 70; root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(80);
    root.scrollHeight = 4000; vi.advanceTimersByTime(3000);
    expect(root.scrollTop).toBe(70); expect(state.value.limrReaderPosition.top).toBe(70);
  });
  it('lets an explicit source reveal interrupt restoration, while ready scroll intent does not', () => {
    const root = new ScrollRoot(); start(root); vi.advanceTimersByTime(32);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'scrollIntent', active: false } }));
    expect(vi.getTimerCount()).toBe(1);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'reveal', offset: 42 } }));
    root.scrollHeight = 4000; root.scrollTo({ top: 230 }); vi.advanceTimersByTime(2200);
    expect(root.scrollTop).toBe(230); expect(state.value.limrReaderPosition.top).toBe(230);
  });
  it('pauses a hidden guest without replacing its position and resumes only when visible', () => {
    const root = new ScrollRoot(); root.clientHeight = 0; start(root);
    vi.advanceTimersByTime(5000); window.dispatchEvent(new Event('beforeunload'));
    expect(vi.getTimerCount()).toBe(0); expect(state.save).not.toHaveBeenCalled();
    root.clientHeight = 600; root.scrollHeight = 4000; resize!(); vi.advanceTimersByTime(16);
    expect(root.scrollTop).toBe(900); expect(state.value.limrReaderPosition.top).toBe(900);
    root.clientHeight = 0; root.scrollTop = 0; window.dispatchEvent(new Event('beforeunload'));
    expect(state.value.limrReaderPosition.top).toBe(900);
  });
  it('throttles scroll persistence, flushes unload, and does not restore another document', () => {
    const root = new ScrollRoot(); root.scrollHeight = 4000; start(root, 'file:///other.md');
    for (let top = 0; top < 100; top++) { root.scrollTop = top; root.dispatchEvent(new Event('scroll')); }
    expect(state.save).not.toHaveBeenCalled(); vi.advanceTimersByTime(80); expect(state.save).toHaveBeenCalledTimes(1);
    root.scrollTop = 150; root.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('beforeunload'));
    expect(state.value.limrReaderPosition).toEqual({ uri: 'file:///other.md', top: 150 });
    dispose!(); dispose = undefined; state.save.mockClear();
    root.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('beforeunload')); vi.runAllTimers();
    expect(state.save).not.toHaveBeenCalled();
  });
});
