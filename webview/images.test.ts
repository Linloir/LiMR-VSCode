import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderImages } from './images';

class ElementFixture {
  images: ImageFixture[] = [];
  contains(image: ImageFixture) { return this.images.includes(image); }
  querySelectorAll() { return this.images; }
}
class ImageFixture extends ElementFixture {
  dataset: Record<string, string> = {};
  constructor(public src: string) { super(); }
  getAttribute(name: string) { return name === 'src' ? this.src : null; }
  setAttribute(name: string, value: string) { if (name === 'src') this.src = value; }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}
let mutation: (records: unknown[]) => void;
const changed = (image: ImageFixture) => mutation([{ type: 'attributes', target: image }]);
const added = (image: ImageFixture) => mutation([{ type: 'childList', addedNodes: [image], removedNodes: [] }]);
function setup(...sources: string[]) {
  const root = new ElementFixture(); root.images = sources.map(source => new ImageFixture(source));
  const send = vi.fn(), resolver = new ReaderImages(root as unknown as HTMLElement, send);
  const reply = (request: number, uri?: string) => resolver.accept({ requestId: send.mock.calls[request][0], src: send.mock.calls[request][1], uri, reason: uri ? undefined : 'missing' });
  return { root, send, resolver, reply };
}

describe('local image bridge lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('Element', ElementFixture); vi.stubGlobal('HTMLImageElement', ImageFixture);
    vi.stubGlobal('MutationObserver', class { constructor(callback: (records: unknown[]) => void) { mutation = callback; } observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces repeated URLs and restores a resolved URL if React resets the source attribute', () => {
    const { root, send, reply } = setup('./same.svg', './same.svg');
    expect(send).toHaveBeenCalledTimes(1);
    reply(0, 'https://resource/same.svg');
    expect(root.images.map(image => image.src)).toEqual(['https://resource/same.svg', 'https://resource/same.svg']);
    changed(root.images[0]);
    root.images[0].src = './same.svg'; changed(root.images[0]);
    expect(root.images[0].src).toBe('https://resource/same.svg');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('never overwrites a replacement URL with an older asynchronous lookup', () => {
    const { root, send, reply } = setup('./old.svg');
    root.images[0].src = './new.svg'; changed(root.images[0]);
    reply(0, 'https://resource/old.svg');
    expect(root.images[0].src).toBe('');
    reply(1, 'https://resource/new.svg');
    expect(root.images[0].src).toBe('https://resource/new.svg');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('does not loop on failures, but newly rendered images can retry after a file appears', () => {
    const { root, send, reply } = setup('./missing.svg');
    reply(0); changed(root.images[0]); added(root.images[0]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(root.images[0].dataset.lvImageError).toBe('missing');
    const next = new ImageFixture('./missing.svg'); root.images.push(next); added(next);
    expect(send).toHaveBeenCalledTimes(2);
    reply(1, 'https://resource/missing.svg');
    expect(next.src).toBe('https://resource/missing.svg');
  });
  it('drops responses after the image is removed or the document controller is disposed', () => {
    const { root, resolver, reply } = setup('./removed.svg', './disposed.svg');
    const removed = root.images.shift()!; reply(0, 'https://resource/removed.svg');
    expect(removed.src).toBe('');
    resolver.dispose(); reply(1, 'https://resource/disposed.svg');
    expect(root.images[0].src).toBe('');
  });
  it('reuses resolved local URLs when a document window remounts its image', () => {
    const { root, send, reply } = setup('./windowed.svg');
    const removed = root.images.shift()!;
    reply(0, 'https://resource/windowed.svg');
    expect(removed.src).toBe('');
    const remounted = new ImageFixture('./windowed.svg'); root.images.push(remounted); added(remounted);
    expect(remounted.src).toBe('https://resource/windowed.svg');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not send a second local-file request for the core preview portal', () => {
    const { root, send, reply } = setup('./preview.svg');
    reply(0, 'https://resource/preview.svg');
    const preview = new ImageFixture(root.images[0].src); root.images.push(preview); added(preview);
    expect(preview.src).toBe('https://resource/preview.svg');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('releases unmounted images during slow lookups and bounds the successful URL cache', () => {
    const { root, send, resolver, reply } = setup('./slow.svg');
    const removed = root.images.shift()!;
    mutation([{ type: 'childList', addedNodes: [], removedNodes: [removed] }]);
    // Pending transport may outlive a DOM window, but may not retain its nodes.
    expect((resolver as any).bySource.get('./slow.svg').images.size).toBe(0);
    reply(0, 'https://resource/slow.svg');
    for (let index = 0; index < 520; index++) {
      const image = new ImageFixture(`./${index}.svg`); root.images = [image]; added(image);
      reply(index + 1, `https://resource/${index}.svg`);
    }
    const recent = new ImageFixture('./519.svg'); root.images = [recent]; added(recent);
    expect(recent.src).toBe('https://resource/519.svg');
    expect(send).toHaveBeenCalledTimes(521);
    const oldest = new ImageFixture('./0.svg'); root.images = [oldest]; added(oldest);
    expect(send).toHaveBeenCalledTimes(522);
    resolver.dispose();
  });
  it('leaves browser-readable URLs alone while resolving explicit local URL forms', () => {
    const { send } = setup('https://example.test/a.png', 'http://localhost/a.png', 'data:image/png;base64,AAAA', 'blob:some-id', '//example.test/a.png', './a.png', '/a.png', 'file:///a.png');
    expect(send.mock.calls.map(call => call[1])).toEqual(['./a.png', '/a.png', 'file:///a.png']);
  });
  it('re-resolves the original Markdown URL when path settings change on a retained image', () => {
    const { root, resolver, reply } = setup('./a.svg');
    reply(0, 'https://resource/old-folder/a.svg'); resolver.dispose();
    const send = vi.fn(), next = new ReaderImages(root as unknown as HTMLElement, send);
    expect(send.mock.calls[0][1]).toBe('./a.svg');
    expect(root.images[0].src).toBe('');
    next.accept({ requestId: send.mock.calls[0][0], src: './a.svg', uri: 'https://resource/new-folder/a.svg' });
    expect(root.images[0].src).toBe('https://resource/new-folder/a.svg');
    next.dispose();
  });
  it('does not leave the old folder image visible if new path settings cannot resolve it', () => {
    const { root, resolver, reply } = setup('./a.svg');
    reply(0, 'https://resource/old-folder/a.svg'); resolver.dispose();
    const send = vi.fn(), next = new ReaderImages(root as unknown as HTMLElement, send);
    next.accept({ requestId: send.mock.calls[0][0], src: './a.svg', reason: 'missing' });
    expect(root.images[0].src).toBe('');
    expect(root.images[0].dataset.lvImageError).toBe('missing');
    changed(root.images[0]); expect(send).toHaveBeenCalledTimes(1);
    next.dispose();
    const retry = vi.fn(), final = new ReaderImages(root as unknown as HTMLElement, retry);
    expect(retry.mock.calls[0][1]).toBe('./a.svg');
    final.accept({ requestId: retry.mock.calls[0][0], src: './a.svg', uri: 'https://resource/restored/a.svg' });
    expect(root.images[0].src).toBe('https://resource/restored/a.svg');
  });
});
