import { floorIndex } from '../src/shared/scroll-sync';

interface SourceBlock { element: HTMLElement; start: number; end: number }
const selector = '.limr-reader-content > article > [data-source-start]';
const anchor = 18;

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
  private readonly observer: MutationObserver;

  constructor(private readonly root: HTMLElement, private readonly enabled: () => boolean, private readonly send: (offset: number) => void) {
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
    root.addEventListener('scroll', this.onScroll, { passive: true });
    // A new user gesture takes control immediately, even within the same frame.
    root.addEventListener('wheel', this.onIntent, { passive: true });
    root.addEventListener('touchstart', this.onIntent, { passive: true });
    root.addEventListener('pointerdown', this.onIntent, { passive: true });
    root.addEventListener('keydown', this.onKey);
  }

  reveal(offset: number) {
    if (!this.enabled() || !Number.isFinite(offset)) return;
    this.pendingReveal = Math.max(0, offset);
    this.schedule();
  }
  dispose() {
    cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.root.removeEventListener('scroll', this.onScroll);
    this.root.removeEventListener('wheel', this.onIntent);
    this.root.removeEventListener('touchstart', this.onIntent);
    this.root.removeEventListener('pointerdown', this.onIntent);
    this.root.removeEventListener('keydown', this.onKey);
  }
  private index() {
    if (this.blocks) return this.blocks;
    this.article = this.root.querySelector('.limr-reader-content > article');
    return this.blocks = [...this.root.querySelectorAll<HTMLElement>(selector)].map(element => ({
      element, start: Number(element.dataset.sourceStart), end: Number(element.dataset.sourceEnd),
    })).filter(block => Number.isFinite(block.start) && Number.isFinite(block.end));
  }
  private onIntent = () => { this.pendingReveal = undefined; this.appliedScrollTop = undefined; };
  private onKey = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) this.onIntent();
  };
  private onScroll = () => {
    if (!this.enabled()) return;
    // Ignore exactly the position we applied, rather than all input for 600 ms.
    if (this.appliedScrollTop !== undefined && Math.abs(this.root.scrollTop - this.appliedScrollTop) < 1) return;
    this.appliedScrollTop = undefined;
    this.schedule();
  };
  private schedule() { if (!this.frame) this.frame = requestAnimationFrame(this.flush); }
  private flush = () => {
    this.frame = 0;
    if (!this.enabled()) { this.pendingReveal = undefined; return; }
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
    if (this.appliedScrollTop !== undefined && Math.abs(this.root.scrollTop - this.appliedScrollTop) < 1) return;
    const index = floorIndex(blocks.length, index => blocks[index].element.getBoundingClientRect().top, viewportTop);
    const block = blocks[index], next = blocks[index + 1];
    const rect = block.element.getBoundingClientRect();
    const endTop = next ? next.element.getBoundingClientRect().top : rect.bottom;
    const progress = Math.max(0, Math.min(1, (viewportTop - rect.top) / Math.max(1, endTop - rect.top)));
    const offset = this.root.scrollTop < 1 ? 0 : Math.round(block.start + progress * ((next?.start ?? block.end) - block.start));
    if (offset !== this.lastOffset) { this.lastOffset = offset; this.send(offset); }
  };
}
