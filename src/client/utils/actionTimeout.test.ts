import { describe, it, expect, vi } from 'vitest';
import { withTimeout, ACTION_TIMEOUT_MS } from './actionTimeout';

describe('ACTION_TIMEOUT_MS', () => {
  it('is a positive number', () => {
    expect(typeof ACTION_TIMEOUT_MS).toBe('number');
    expect(ACTION_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise resolves before the timeout', async () => {
    const promise = Promise.resolve(42);
    const result = await withTimeout(promise, 1_000, 'test');
    expect(result).toBe(42);
  });

  it('resolves with a string value', async () => {
    const result = await withTimeout(Promise.resolve('hello'), 1_000, 'test');
    expect(result).toBe('hello');
  });

  it('resolves with undefined', async () => {
    const result = await withTimeout(Promise.resolve(undefined), 1_000, 'test');
    expect(result).toBeUndefined();
  });

  it('rejects with a timeout error when the promise takes too long', async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<never>(() => { /* intentionally never resolves */ });
    const p = withTimeout(neverResolves, 100, 'myOperation');
    vi.advanceTimersByTime(100);
    await expect(p).rejects.toThrow('myOperation timed out after 100ms');
    vi.useRealTimers();
  });

  it('timeout error message includes the label and timeoutMs', async () => {
    vi.useFakeTimers();
    const neverResolves = new Promise<never>(() => { /* intentionally never resolves */ });
    const p = withTimeout(neverResolves, 500, 'fetchData');
    vi.advanceTimersByTime(500);
    await expect(p).rejects.toThrow('fetchData timed out after 500ms');
    vi.useRealTimers();
  });

  it('propagates rejection from the underlying promise', async () => {
    const failing = Promise.reject(new Error('network error'));
    await expect(withTimeout(failing, 1_000, 'test')).rejects.toThrow('network error');
  });

  it('clears the timeout when the promise resolves (no dangling timer)', async () => {
    vi.useFakeTimers();
    const fastPromise = new Promise<string>(resolve => {
      setTimeout(() => resolve('done'), 10);
    });
    const p = withTimeout(fastPromise, 5_000, 'test');
    vi.advanceTimersByTime(10);
    const result = await p;
    expect(result).toBe('done');
    // Advance well past the timeout to confirm no late rejection fires
    vi.advanceTimersByTime(10_000);
    vi.useRealTimers();
  });

  it('clears the timeout when the promise rejects (no dangling timer)', async () => {
    vi.useFakeTimers();
    const failingPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('fast fail')), 10);
    });
    const p = withTimeout(failingPromise, 5_000, 'test');
    vi.advanceTimersByTime(10);
    await expect(p).rejects.toThrow('fast fail');
    vi.advanceTimersByTime(10_000); // confirm no second rejection
    vi.useRealTimers();
  });

  it('does not resolve if the timeout fires before the promise', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const slowPromise = new Promise<string>(resolve => {
      setTimeout(() => { resolved = true; resolve('late'); }, 1_000);
    });
    const p = withTimeout(slowPromise, 100, 'test');
    vi.advanceTimersByTime(100);
    await expect(p).rejects.toThrow('timed out');
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(900);
    vi.useRealTimers();
  });
});
