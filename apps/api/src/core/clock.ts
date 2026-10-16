// All business time comes from the shop clock: real time plus an offset that the QA lab can move forward,
// so time-based rules (link expiry, lockouts, later the return window) can be tested without waiting.
import type { Db } from './db.js';

const CACHE_MS = 2_000;

export class Clock {
  private offsetMs = 0;
  private loadedAt = -Infinity;

  constructor(
    private readonly db: Db,
    private readonly realNow: () => number = Date.now,
  ) {}

  /** The shop's current time. Reads the offset at most every 2 seconds, so other instances catch up quickly. */
  async now(): Promise<Date> {
    if (this.realNow() - this.loadedAt > CACHE_MS) {
      const row = await this.db.one<{ value: number }>("SELECT value FROM qa_settings WHERE key = 'clock_offset_seconds'");
      this.offsetMs = Number(row?.value ?? 0) * 1000;
      this.loadedAt = this.realNow();
    }
    return new Date(this.realNow() + this.offsetMs);
  }

  async offsetSeconds(): Promise<number> {
    await this.now();
    return Math.round(this.offsetMs / 1000);
  }

  async setOffsetSeconds(seconds: number): Promise<void> {
    await this.db.query("UPDATE qa_settings SET value = to_jsonb($1::int) WHERE key = 'clock_offset_seconds'", [seconds]);
    this.loadedAt = -Infinity;
  }
}

export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
