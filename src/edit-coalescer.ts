/** Only asynchronous documents get an input quiet period. A maximum wait keeps
 * continuous typing from starving the preview; small documents stay immediate. */
export class EditCoalescer<T> {
  private readonly pending = new Map<string, { value: T; idle: ReturnType<typeof setTimeout>; deadline: ReturnType<typeof setTimeout> }>();
  constructor(private readonly send: (value: T) => void, private readonly delay = 250, private readonly maxWait = 1200) {}
  schedule(key: string, value: T, large: boolean) {
    if (!large) { this.cancel(key); this.send(value); return; }
    const previous = this.pending.get(key);
    if (previous) { clearTimeout(previous.idle); previous.value = value; previous.idle = setTimeout(() => this.flush(key), this.delay); }
    else this.pending.set(key, { value, idle: setTimeout(() => this.flush(key), this.delay), deadline: setTimeout(() => this.flush(key), this.maxWait) });
  }
  flush(key: string) {
    const entry = this.pending.get(key); if (!entry) return;
    this.cancel(key); this.send(entry.value);
  }
  cancel(key: string) {
    const entry = this.pending.get(key); if (!entry) return;
    clearTimeout(entry.idle); clearTimeout(entry.deadline); this.pending.delete(key);
  }
  dispose() { for (const key of this.pending.keys()) this.cancel(key); }
}
