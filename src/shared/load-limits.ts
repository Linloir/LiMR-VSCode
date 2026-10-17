/** Limits apply to the current editor buffer, including unsaved changes. */
export const MAX_DOCUMENT_BYTES = 75 * 1024 * 1024;
export const MAX_LOAD_MS = 60_000;
// Supplementary source decorations must not allocate a second full AST beside
// a large reader. VS Code's own Markdown grammar continues to color the editor.
export const MAX_HIGHLIGHT_CHARS = 4 * 1024 * 1024;

export type ReaderLoadError = 'too-large' | 'timeout';
/** Avoid allocating another document-sized Blob just to validate an edit. */
export function fitsPreviewLimit(source: string): boolean {
  if (source.length <= MAX_DOCUMENT_BYTES / 3) return true;
  if (source.length > MAX_DOCUMENT_BYTES) return false;
  let bytes = 0;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && source.charCodeAt(index + 1) >= 0xDC00 && source.charCodeAt(index + 1) <= 0xDFFF) { bytes += 4; index++; }
    else bytes += 3;
    if (bytes > MAX_DOCUMENT_BYTES) return false;
  }
  return true;
}
export function loadErrorMessage(error: ReaderLoadError, locale: string): string {
  return error === 'too-large'
    ? locale === 'zh-CN' ? '文档超过 75 MiB，无法加载预览。' : 'This document exceeds the 75 MiB preview limit.'
    : locale === 'zh-CN' ? '加载超过 60 秒，已停止。可以重试或打开源码。' : 'Loading exceeded 60 seconds and was stopped. Retry or open the source.';
}

/** Runs in the extension host, independently of webview/parser responsiveness.
 * Progress cannot extend a deadline. A different revision or retry can. */
export class LoadWatchdog<Key> {
  private readonly pending = new Map<Key, { version: number; requestId?: string; deadline: number; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly timeout: (key: Key, version: number) => void) {}
  start(key: Key, version: number, requestId?: string) {
    const previous = this.pending.get(key);
    if (previous?.version === version && (!requestId || !previous.requestId || previous.requestId === requestId)) {
      previous.requestId ??= requestId;
      return;
    }
    this.stop(key);
    const current = { version, requestId, deadline: Date.now() + MAX_LOAD_MS, timer: setTimeout(() => {
      if (this.pending.get(key) !== current) return;
      this.stop(key); this.timeout(key, version);
    }, MAX_LOAD_MS) };
    this.pending.set(key, current);
  }
  expired(key: Key) { const current = this.pending.get(key); return !!current && Date.now() >= current.deadline; }
  stop(key: Key) { clearTimeout(this.pending.get(key)?.timer); this.pending.delete(key); }
  dispose() { for (const key of this.pending.keys()) this.stop(key); }
}
