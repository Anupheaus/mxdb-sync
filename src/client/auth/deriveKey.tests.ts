import { describe, it, expect } from 'vitest';
import { deriveKey } from './deriveKey';

describe('deriveKey', () => {
  it('returns a 32-byte Uint8Array from an ArrayBuffer', async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const key = await deriveKey(prfOutput);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(32);
  });

  it('returns the same key for the same PRF output', async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const key1 = await deriveKey(prfOutput);
    const key2 = await deriveKey(prfOutput);
    expect(Array.from(key1)).toEqual(Array.from(key2));
  });

  it('returns different keys for different PRF outputs', async () => {
    const a = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const b = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const key1 = await deriveKey(a);
    const key2 = await deriveKey(b);
    expect(Array.from(key1)).not.toEqual(Array.from(key2));
  });
});
