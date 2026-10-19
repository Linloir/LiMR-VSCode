import { floorIndex } from '../src/shared/scroll-sync';

interface SourceBlock { element: HTMLElement; start: number; end: number }
const selector = '.limr-reader-content > article > [data-source-start]';
const anchor = 18;
export interface ReaderScrollBridge {
  getReadingPosition(): { source: number; offset: number } | null;
  restoreReadingPosition(position: { source: number; offset: number }): void;
}

/** The DOM index is rebuilt only when content changes. A scroll reads O(log n)
 * block rectangles once per animation frame, never all inline source spans.
 */
export class ReaderScrollSync {
  private blocks: SourceBlock[] | undefined;
  private article: HTMLElement | null = null;
  private frame = 0;
  private pendingReveal: number | undefined;
  private appliedScrollTop: number | undefined;
  private lastOffset: number | undefined;
  private readerInput = false;
  private inputEpoch = 0;
  private sourceGeneration = 0;
  private readonly observer?: MutationObserver;

  constructor(private readonly root: HTMLElement, private readonly enabled: () => boolean, private readonly send: (offset: number, epoch: number, generation: number) => void,
    private readonly inputChanged: (active: boolean, epoch: number, generation: number) => void = () => {},
    private readonly getReader?: () => ReaderScrollBridge | null) {
    // The public bridge owns its source index and gets an explicit refresh when
    // loading completes. Observe DOM mutations only for the legacy fallback;
    // KP layout and virtual mounts otherwise produce unused subtree records.
    if (!getReader) {
      this.observer = new MutationObserver(records => {
        // Popovers, inline highlights and lazy block renderers can mutate while
        // scrolling without changing the article's source-block index.
        const article = this.article;
        if (!article?.isConnected || records.some(record => record.type === 'attributes'
          ? (record.target as Element).parentElement === article
          : record.target === article || record.target instanceof Element && record.target.contains(article))) {
          this.blocks = undefined;
          if (this.pendingReveal !== undefined) this.schedule();
        }
      });
      this.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-source-start', 'data-source-end'] });
    }
    root.addEventListener('scroll', this.onScroll, { passive: true });
    // A new user gesture takes control immediately, even within the same frame.
    root.addEventListener('wheel', this.onIntent, { passive: true });
    root.addEventListener('touchstart', this.onIntent, { passive: true });
    root.addEventListener('pointerdown', this.onIntent, { passive: true });
    root.addEventListener('keydown', this.onKey);
    // Native editor range notifications have no origin field. Keep ownership
    // with the real reader gesture until input leaves this webview; a delayed
    // native smooth-scroll frame must never become a new reader scroll command.
    document.body.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('blur', this.onLeave);
  }

  reveal(offset: number) {
    if (this.readerInput || !this.enabled() || !Number.isFinite(offset)) return;
    this.pendingReveal = Math.max(0, offset);
    this.schedule();
  }
  dispose() {
    this.onLeave();
    cancelAnimationFrame(this.frame); this.observer?.disconnect();
    this.root.removeEventListener('scroll', this.onScroll);
    this.root.removeEventListener('wheel', this.onIntent);
    this.root.removeEventListener('touchstart', this.onIntent);
    this.root.removeEventListener('pointerdown', this.onIntent);
    this.root.removeEventListener('keydown', this.onKey);
    document.body.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('blur', this.onLeave);
  }
  /** A real keyboard/mouse action in the native editor transfers ownership. */
  release(epoch = this.inputEpoch) {
    if (epoch !== this.inputEpoch) return;
    this.readerInput = false; this.pendingReveal = undefined; this.lastOffset = undefined;
    cancelAnimationFrame(this.frame); this.frame = 0;
  }
  sourceInput(generation: number, epoch?: number) {
    if (generation > this.sourceGeneration) this.sourceGeneration = generation;
    else if (generation < this.sourceGeneration || epoch !== this.inputEpoch) return;
    this.readerInput = false; this.lastOffset = undefined;
    // Ownership updates can arrive between a throttled source reveal and its
    // animation frame. Keep that latest source target and its original frame;
    // cancelling it on every generation makes continuous input wait for quiet.
    // A reader gesture still cancels the target immediately in onIntent.
    if (this.pendingReveal === undefined) { cancelAnimationFrame(this.frame); this.frame = 0; }
  }
  reset() { this.onLeave(); this.release(); this.appliedScrollTop = undefined; }
  /** Loading may finish after a source reveal. Retry it with the public bridge. */
  refresh() { this.blocks = undefined; if (this.pendingReveal !== undefined) this.schedule(); }
  private index() {
    if (this.blocks) return this.blocks;
    this.article = this.root.querySelector('.limr-reader-content > article');
    return this.blocks = [...this.root.querySelectorAll<HTMLElement>(selector)].map(element => ({
      element, start: Number(element.dataset.sourceStart), end: Number(element.dataset.sourceEnd),
    })).filter(block => Number.isFinite(block.start) && Number.isFinite(block.end));
  }
  private onIntent = () => {
    this.pendingReveal = undefined; this.appliedScrollTop = undefined;
    if (!this.readerInput && this.enabled()) { this.readerInput = true; this.inputChanged(true, ++this.inputEpoch, this.sourceGeneration); }
  };
  private onLeave = () => { if (this.readerInput) { this.release(); this.inputChanged(false, this.inputEpoch, this.sourceGeneration); } };
  private onKey = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) this.onIntent();
  };
  private onScroll = () => {
    if (!this.enabled() || !this.readerInput) return;
    // Ignore exactly the position we applied, rather than all input for 600 ms.
    if (this.appliedScrollTop !== undefined && Math.abs(this.root.scrollTop - this.appliedScrollTop) < 1) return;
    this.appliedScrollTop = undefined;
    this.schedule();
  };
  private schedule() { if (!this.frame) this.frame = requestAnimationFrame(this.flush); }
  private flush = () => {
    this.frame = 0;
    if (!this.enabled()) { this.pendingReveal = undefined; return; }
    if (this.getReader) {
      const reader = this.getReader();
      if (!reader) return;
      if (this.pendingReveal !== undefined) {
        const offset = this.pendingReveal; this.pendingReveal = undefined;
        // Source offset zero means the scroll boundary, not the first glyph's
        // baseline (which is a few pixels below the padding for plain text).
        // Retire any pending virtual seek with a clamped start request before
        // setting the physical boundary, so its refinement cannot pull us back.
        reader.restoreReadingPosition({ source: offset, offset: offset === 0 ? this.root.scrollHeight : anchor });
        if (offset === 0) this.root.scrollTo({ top: 0, behavior: 'instant' });
        this.appliedScrollTop = this.root.scrollTop;
        this.lastOffset = undefined;
      } else if (this.readerInput) {
        const position = reader.getReadingPosition();
        const offset = this.root.scrollTop < 1 ? 0 : position?.source;
        if (offset !== undefined && offset !== this.lastOffset) { this.lastOffset = offset; this.send(offset, this.inputEpoch, this.sourceGeneration); }
      }
      return;
    }
    const blocks = this.index();
    if (!blocks.length) return;
    const viewportTop = this.root.getBoundingClientRect().top + anchor;
    if (this.pendingReveal !== undefined) {
      const offset = this.pendingReveal; this.pendingReveal = undefined;
      const index = floorIndex(blocks.length, index => blocks[index].start, offset);
      const block = blocks[index], next = blocks[index + 1];
      const rect = block.element.getBoundingClientRect();
      const endTop = next ? next.element.getBoundingClientRect().top : rect.bottom;
      const endOffset = next?.start ?? block.end;
      const progress = Math.max(0, Math.min(1, (offset - block.start) / Math.max(1, endOffset - block.start)));
      const top = offset === 0 ? 0 : this.root.scrollTop + rect.top - viewportTop + progress * (endTop - rect.top);
      this.root.scrollTo({ top, behavior: 'instant' });
      this.appliedScrollTop = this.root.scrollTop;
      this.lastOffset = undefined;
      return;
    }
    if (!this.readerInput) return;
    if (this.appliedScrollTop !== undefined && Math.abs(this.root.scrollTop - this.appliedScrollTop) < 1) return;
    const index = floorIndex(blocks.length, index => blocks[index].element.getBoundingClientRect().top, viewportTop);
    const block = blocks[index], next = blocks[index + 1];
    const rect = block.element.getBoundingClientRect();
    const endTop = next ? next.element.getBoundingClientRect().top : rect.bottom;
    const progress = Math.max(0, Math.min(1, (viewportTop - rect.top) / Math.max(1, endTop - rect.top)));
    const offset = this.root.scrollTop < 1 ? 0 : Math.round(block.start + progress * ((next?.start ?? block.end) - block.start));
    if (offset !== this.lastOffset) { this.lastOffset = offset; this.send(offset, this.inputEpoch, this.sourceGeneration); }
  };
}
