import { describe, it, expect } from 'vitest';
import { createSeed } from './createSeed';

describe('createSeed', () => {
  it('returns the given onSeed function', () => {
    const onSeed = async () => {};
    expect(createSeed(onSeed)).toBe(onSeed);
  });
});
