import { describe, it, expect } from 'vitest';
import { getNowTime } from './utils';

describe('getNowTime', () => {
  it('returns a number', () => {
    const t = getNowTime();
    expect(typeof t).toBe('number');
  });

  it('returns a value that looks like a Unix timestamp (ms)', () => {
    const t = getNowTime();
    // Roughly 2020–2040 in ms
    expect(t).toBeGreaterThan(1577836800000);
    expect(t).toBeLessThan(2208988800000);
  });

  it('increases when called later', async () => {
    const t1 = getNowTime();
    await new Promise(r => setTimeout(r, 5));
    const t2 = getNowTime();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});
