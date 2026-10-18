import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditCoalescer } from '../src/edit-coalescer';
describe('large-document edit scheduling', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps small documents immediate and merges a burst into the latest large revision', () => {
    vi.useFakeTimers(); const send = vi.fn(), scheduler = new EditCoalescer(send);
    scheduler.schedule('small', 1, false); expect(send).toHaveBeenCalledWith(1);
    for (let version = 2; version <= 8; version++) { scheduler.schedule('large', version, true); vi.advanceTimersByTime(50); }
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250); expect(send.mock.calls).toEqual([[1], [8]]); scheduler.dispose();
  });
  it('bounds continuous typing and cancels work on disposal', () => {
    vi.useFakeTimers(); const send = vi.fn(), scheduler = new EditCoalescer(send);
    for (let version = 0; version < 12; version++) { scheduler.schedule('large', version, true); vi.advanceTimersByTime(100); }
    expect(send.mock.calls).toEqual([[11]]);
    scheduler.schedule('large', 12, true); scheduler.dispose(); vi.advanceTimersByTime(2000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
