// Keeps Club API traffic polite: one request at a time with a gap between them,
// an hourly budget, and a growing pause after errors.

export class Blocked extends Error {}

export type LimiterOptions = {
  gapMs: number;
  perHour: number;
  backoffMs: number;
  maxBackoffMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class Limiter {
  private chain: Promise<unknown> = Promise.resolve();
  private sent: number[] = [];
  private pausedUntil = 0;
  private backoff: number;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  /** Requests actually sent, for the log. */
  total = 0;

  private options: LimiterOptions;

  constructor(options: LimiterOptions) {
    this.options = options;
    this.backoff = options.backoffMs;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Why no request can go out right now, or null if one can. */
  blockedReason(): string | null {
    const now = this.now();
    if (now < this.pausedUntil) return 'paused after errors';
    this.sent = this.sent.filter((time) => now - time < 60 * 60 * 1000);
    if (this.sent.length >= this.options.perHour) return 'hourly limit reached';
    return null;
  }

  /**
   * Runs `task` in turn. Throws Blocked, without sending, while paused or over budget.
   * `force` is for a request someone asked for by hand: it skips the pause and the budget
   * (it still counts towards the budget), but not a permanent stop.
   */
  run<T>(task: () => Promise<T>, { force = false } = {}): Promise<T> {
    const next = this.chain.then(async () => {
      const reason = this.blockedReason();
      if (reason && !(force && this.pausedUntil !== Infinity)) throw new Blocked(reason);
      this.sent.push(this.now());
      this.total++;
      try {
        return await task();
      } finally {
        await this.sleep(this.options.gapMs);
      }
    });
    this.chain = next.catch(() => {});
    return next;
  }

  /** After a failure: stop sending for a while, longer each time. */
  pause() {
    this.pausedUntil = this.now() + this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.options.maxBackoffMs);
  }

  /** After a success: errors start from the shortest pause again. */
  recovered() {
    this.backoff = this.options.backoffMs;
  }

  /** Stop for good, e.g. when the API key is rejected. */
  stop() {
    this.pausedUntil = Infinity;
  }
}
