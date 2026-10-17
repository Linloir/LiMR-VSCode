import { afterEach, expect, it, vi } from 'vitest';
import { fitsPreviewLimit, LoadWatchdog, MAX_DOCUMENT_BYTES, MAX_LOAD_MS } from '../src/shared/load-limits';
import { previewBuffer, readerStateMessage } from '../src/reader-buffer';
import type { ReaderState } from '../src/shared/protocol';

afterEach(() => vi.useRealTimers());
it('accepts exactly 75 MiB of UTF-8 and rejects one byte more, including unsaved multibyte text', () => {
  const source = '中'.repeat(MAX_DOCUMENT_BYTES / 3);
  expect(previewBuffer(source.length, () => source)).toEqual({ source });
  expect(previewBuffer(source.length + 1, () => source + 'a')).toEqual({ source: '', loadError: 'too-large' });
  expect(fitsPreviewLimit(source)).toBe(true);
  expect(fitsPreviewLimit(source + 'a')).toBe(false);
  expect(fitsPreviewLimit('a'.repeat(MAX_DOCUMENT_BYTES - 4) + '💡')).toBe(true);
  expect(fitsPreviewLimit('a'.repeat(MAX_DOCUMENT_BYTES - 3) + '💡')).toBe(false);
  const read = vi.fn();
  expect(previewBuffer(MAX_DOCUMENT_BYTES + 1, read).loadError).toBe('too-large');
  expect(read).not.toHaveBeenCalled();
});
it('binary transport preserves BOM, CRLF, non-BMP text and does not duplicate source in the JSON envelope', () => {
  const source = '\uFEFF' + '中文 💡\r\n'.repeat(12_000);
  const state = { document: { source } } as ReaderState;
  const message = readerStateMessage(state);
  expect(message.state.document.source).toBe('');
  expect(message.sourceBytes?.byteLength).toBe(Buffer.byteLength(source));
  expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(message.sourceBytes)).toBe(source);
  expect(state.document.source).toBe(source);
  const invalid = { document: { source: source + '\uD800' } } as ReaderState;
  expect(readerStateMessage(invalid)).toEqual({ type: 'state', state: invalid });
});
it('the host deadline includes startup and progress cannot extend its 60 seconds', () => {
  vi.useFakeTimers(); const expired = vi.fn(), watchdog = new LoadWatchdog(expired);
  watchdog.start('panel', 1);
  vi.advanceTimersByTime(20_000); watchdog.start('panel', 1, 'worker-1');
  vi.advanceTimersByTime(20_000); watchdog.start('panel', 1, 'worker-1');
  vi.advanceTimersByTime(19_999); expect(expired).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(expired).toHaveBeenCalledExactlyOnceWith('panel', 1);
  watchdog.dispose();
});
it('completion, cancellation, replacement, retry and disposal retire stale deadlines', () => {
  vi.useFakeTimers(); const expired = vi.fn(), watchdog = new LoadWatchdog(expired);
  watchdog.start('panel', 1, 'old');
  vi.advanceTimersByTime(50_000); watchdog.start('panel', 2, 'new');
  vi.advanceTimersByTime(50_000); expect(expired).not.toHaveBeenCalled();
  watchdog.start('panel', 2, 'retry');
  vi.advanceTimersByTime(50_000); expect(expired).not.toHaveBeenCalled();
  watchdog.stop('panel'); vi.advanceTimersByTime(MAX_LOAD_MS); expect(expired).not.toHaveBeenCalled();
  watchdog.start('one', 1); watchdog.start('two', 1); watchdog.dispose();
  vi.advanceTimersByTime(MAX_LOAD_MS); expect(expired).not.toHaveBeenCalled();
});
