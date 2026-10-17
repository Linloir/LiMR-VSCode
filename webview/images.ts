interface ImageReply { requestId: string; src: string; uri?: string; reason?: 'missing' | 'ambiguous' | 'unsupported' }
interface ImageState { source: string; resolved?: string; generation: number }
interface ImageRequest { requestId: string; source: string; images: Set<HTMLImageElement> }
const directlyReadable = /^(?:https?:|data:|blob:|vscode-webview-resource:|vscode-resource:|\/\/)/i;
// React can retain the same image node across a reader-setting update. Keep
// original source provenance without putting implementation state in Markdown.
const imageSources = new WeakMap<HTMLImageElement, ImageState>();
const maxCachedImages = 512;
let generation = 0;

/** Resolve image paths through the extension host, including images produced by
 * syntax plugins. Only source changes or newly inserted images do work here.
 */
export class ReaderImages {
  private readonly states = imageSources;
  private readonly generation = ++generation;
  private readonly cache = new Map<string, string>();
  private readonly requests = new Map<string, ImageRequest>();
  private readonly bySource = new Map<string, ImageRequest>();
  private readonly observer: MutationObserver;
  private disposed = false;

  constructor(private readonly root: HTMLElement, private readonly send: (requestId: string, src: string) => void) {
    this.observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') this.resolve(record.target as HTMLImageElement);
        else {
          for (const node of record.removedNodes) if (node instanceof Element) this.release(node);
          for (const node of record.addedNodes) if (node instanceof Element) this.scan(node);
        }
      }
    });
    this.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    this.scan(root);
  }
  accept(reply: ImageReply) {
    if (this.disposed) return;
    const request = this.requests.get(reply.requestId);
    if (!request || request.source !== reply.src) return;
    this.requests.delete(reply.requestId); this.bySource.delete(request.source);
    if (reply.uri) {
      this.cache.set(request.source, reply.uri);
      if (this.cache.size > maxCachedImages) this.cache.delete(this.cache.keys().next().value!);
      for (const image of request.images) this.apply(image, request.source, reply.uri);
    } else for (const image of request.images) {
      const state = this.states.get(image), current = image.getAttribute('src')?.trim() ?? '';
      if (state?.generation === this.generation && state.source === request.source && (current === state.source || current === state.resolved)) {
        // An unresolved explicit base must not silently load a same-named file
        // through the browser's document-relative <base>. Preserve provenance
        // in the WeakMap while leaving the image's accessible alt text intact.
        state.resolved = '';
        image.removeAttribute('src');
        image.dataset.lvImageError = reply.reason ?? 'missing';
      }
    }
    request.images.clear();
  }
  dispose() {
    this.disposed = true; this.observer.disconnect();
    this.requests.clear(); this.bySource.clear(); this.cache.clear();
  }
  private scan(element: Element) {
    if (element instanceof HTMLImageElement) this.resolve(element);
    for (const image of element.querySelectorAll('img')) this.resolve(image);
  }
  private release(element: Element) {
    const release = (image: HTMLImageElement) => {
      if (this.root.contains(image)) return; // A move within the live reader.
      const state = this.states.get(image);
      if (state) this.bySource.get(state.source)?.images.delete(image);
    };
    if (element instanceof HTMLImageElement) release(element);
    for (const image of element.querySelectorAll('img')) release(image);
  }
  private resolve(image: HTMLImageElement) {
    if (!(image instanceof HTMLImageElement) || !this.root.contains(image)) return;
    const current = image.getAttribute('src')?.trim() ?? '';
    const previous = this.states.get(image);
    const refresh = previous && previous.generation !== this.generation;
    const source = refresh && current === previous.resolved ? previous.source : current;
    if (!source) return;
    if (!refresh && previous && source === previous.resolved) return;
    if (!refresh && previous && source === previous.source) { if (previous.resolved !== undefined) this.apply(image, source, previous.resolved); return; }
    if (previous) this.bySource.get(previous.source)?.images.delete(image);
    this.states.set(image, { source, generation: this.generation, resolved: refresh && current === previous.resolved ? current : undefined });
    delete image.dataset.lvImageError;
    if (directlyReadable.test(source)) return;
    // The browser's <base> is not necessarily the configured image directory.
    // Do not paint a wrong same-named file while the host checks this path.
    this.states.get(image)!.resolved = '';
    image.removeAttribute('src');
    if (this.cache.has(source)) {
      const uri = this.cache.get(source)!;
      this.cache.delete(source); this.cache.set(source, uri);
      this.apply(image, source, uri);
      return;
    }
    const existing = this.bySource.get(source);
    if (existing) { existing.images.add(image); return; }
    const request = { requestId: crypto.randomUUID(), source, images: new Set([image]) };
    this.requests.set(request.requestId, request); this.bySource.set(source, request);
    this.send(request.requestId, source);
  }
  private apply(image: HTMLImageElement, source: string, uri: string) {
    const state = this.states.get(image);
    // A React source update, plugin rerender or document switch can outlive the
    // file lookup. A stale response must never overwrite its replacement.
    const current = image.getAttribute('src')?.trim() ?? '';
    if (!state || state.generation !== this.generation || state.source !== source || (current !== source && current !== state.resolved) || !this.root.contains(image)) return;
    state.resolved = uri;
    if (uri) { delete image.dataset.lvImageError; image.setAttribute('src', uri); }
    else image.removeAttribute('src');
  }
}
