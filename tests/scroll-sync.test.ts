import { afterEach, describe, expect, it, vi } from 'vitest';
import { floorIndex, ScrollThrottle } from '../src/shared/scroll-sync';

describe('continuous scroll delivery', () => {
  afterEach(() => vi.useRealTimers());
  it('follows an ongoing gesture and delivers its final position without waiting for quiet', () => {
    vi.useFakeTimers();
    const sent: number[] = [], sync = new ScrollThrottle<string, number>((_, value) => sent.push(value));
    sync.push('source', 0);
    expect(sent).toEqual([0]);
    for (let value = 1; value <= 32; value++) {
      vi.advanceTimersByTime(8); sync.push('source', value);
      if (value === 16) expect(sent.length).toBeGreaterThanOrEqual(4);
    }
    vi.advanceTimersByTime(32);
    expect(sent.at(-1)).toBe(32);
    expect(sent.length).toBeLessThanOrEqual(10);
    sync.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps pending editors independent and cancels stale source input on reader takeover', () => {
    vi.useFakeTimers();
    const send = vi.fn(), sync = new ScrollThrottle<string, number>(send);
    sync.push('first.md', 1); sync.push('first.md', 2); sync.push('second.md', 3);
    sync.cancel('first.md');
    vi.advanceTimersByTime(32);
    expect(send.mock.calls).toEqual([['first.md', 1], ['second.md', 3]]);
    sync.push('second.md', 4); sync.dispose(); vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('locates document blocks in logarithmic work, including boundaries and gaps', () => {
    const read = vi.fn((index: number) => index * 10);
    expect(floorIndex(10_000, read, 87_654)).toBe(8765);
    expect(read.mock.calls.length).toBeLessThanOrEqual(14);
    expect(floorIndex(3, index => [10, 25, 90][index], 0)).toBe(0);
    expect(floorIndex(3, index => [10, 25, 90][index], 25)).toBe(1);
    expect(floorIndex(3, index => [10, 25, 90][index], 100)).toBe(2);
  });
});
