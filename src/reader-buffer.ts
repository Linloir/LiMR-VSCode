import { MAX_DOCUMENT_BYTES } from './shared/load-limits';
import type { HostMessage, ReaderState } from './shared/protocol';

export function previewBuffer(characters: number, read: () => string): { source: string; loadError?: 'too-large' } {
  if (characters > MAX_DOCUMENT_BYTES) return { source: '', loadError: 'too-large' };
  const source = read();
  return Buffer.byteLength(source, 'utf8') > MAX_DOCUMENT_BYTES ? { source: '', loadError: 'too-large' } : { source };
}

/** VS Code 1.57+ transfers ArrayBuffers outside its JSON envelope. Avoid the
 * JSON stringify/parse copies of large sources, preserving BOMs and exact text.
 * Invalid UTF-16 stays on the lossless string path instead of being repaired. */
export function readerStateMessage(state: ReaderState): Extract<HostMessage, { type: 'state' }> {
  const source = state.document.source;
  if (source.length < 64 * 1024 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) return { type: 'state', state };
  const bytes = Buffer.allocUnsafeSlow(Buffer.byteLength(source, 'utf8'));
  bytes.write(source, 'utf8');
  return { type: 'state', state: { ...state, document: { ...state.document, source: '' } }, sourceBytes: bytes.buffer as ArrayBuffer, sourceCharacters: source.length };
}
