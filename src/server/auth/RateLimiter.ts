/**
 * §4.4 — In-memory rate limiter for invite redemption.
 *
 * Limits per source IP: `maxAttempts` within a rolling `windowMs` window.
 * Resets automatically when the window expires. Not shared across processes —
 * for multi-instance deployments, use an external store (out of scope).
 */

interface Entry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.#maxAttempts = maxAttempts;
    this.#windowMs = windowMs;
  }

  #maxAttempts: number;
  #windowMs: number;
  #store = new Map<string, Entry>();

  /** Returns `true` if the request is allowed; `false` if the IP is rate-limited. */
  check(ip: string, additionalKey?: string): boolean {
    this.#cleanup();
    const now = Date.now();
    const key = additionalKey ? `${ip}:${additionalKey}` : ip;
    let entry = this.#store.get(key);
    if (entry == null || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.#windowMs };
      this.#store.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.#maxAttempts;
  }

  /** Manually clear the record for an IP (e.g. after a successful attempt). */
  reset(ip: string, additionalKey?: string): void {
    const key = additionalKey ? `${ip}:${additionalKey}` : ip;
    this.#store.delete(key);
  }

  #cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.#store) {
      if (now > entry.resetAt) this.#store.delete(key);
    }
  }
}

/** Singleton rate limiter for invite redemption. */
export const inviteRateLimiter = new RateLimiter();
