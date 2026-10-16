/** Send immediately, then keep the latest position for every editor at a bounded rate.
 * A trailing debounce never runs during a continuous wheel/trackpad gesture.
 */
export class ScrollThrottle<Key, Value> {
  private readonly pending = new Map<Key, Value>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly send: (key: Key, value: Value) => void, private readonly interval = 32) {}

  push(key: Key, value: Value) {
    this.pending.set(key, value);
    if (!this.timer) this.flush();
  }
  cancel(key: Key) { this.pending.delete(key); }
  dispose() { clearTimeout(this.timer); this.timer = undefined; this.pending.clear(); }
  private flush = () => {
    this.timer = undefined;
    if (!this.pending.size) return;
    const values = [...this.pending]; this.pending.clear();
    // Set the timer first so a synchronous callback cannot reenter the flush.
    this.timer = setTimeout(this.flush, this.interval);
    values.forEach(([key, value]) => this.send(key, value));
  };
}

/** Index immediately before (or at) a value in a monotonic sequence. */
export function floorIndex(length: number, valueAt: (index: number) => number, value: number): number {
  let left = 0, right = length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (valueAt(middle) <= value) left = middle + 1;
    else right = middle;
  }
  return Math.max(0, left - 1);
}
