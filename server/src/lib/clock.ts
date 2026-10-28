export interface TimerHandle {
  cancel(): void;
}

/** Injectable time source so reliability tests can simulate 90-minute sessions instantly. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return { cancel: () => clearTimeout(t) };
  },
};

/** Deterministic clock for tests: time only moves when advance() is called. */
export class ManualClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: Array<{ at: number; id: number; fn: () => void }> = [];
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), id, fn });
    return { cancel: () => (this.timers = this.timers.filter((x) => x.id !== id)) };
  }
  /** Moves time forward, running due timers in order (timers may schedule more timers). */
  advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = target;
  }
}
