import { describe, expect, it } from 'vitest';
import { IndexedDbContext } from './IndexedDbContext';
import type { MXDBAuthEntry } from './IndexedDbAuthStore';

// React createContext stores the default value in `_currentValue` on the context object.
function getDefaultValue<T>(ctx: React.Context<T>): T {
  return (ctx as unknown as { _currentValue: T })._currentValue;
}

describe('IndexedDbContext — default value', () => {
  it('getDefault resolves to undefined', async () => {
    const result = await getDefaultValue(IndexedDbContext).getDefault();
    expect(result).toBeUndefined();
  });

  it('saveEntry resolves without throwing', async () => {
    const entry: MXDBAuthEntry = {
      id: 'test-id',
      credentialId: new Uint8Array([1, 2, 3]),
      dbName: 'test-db',
      isDefault: false,
    };
    await expect(getDefaultValue(IndexedDbContext).saveEntry(entry)).resolves.toBeUndefined();
  });

  it('clearDefault resolves without throwing', async () => {
    await expect(getDefaultValue(IndexedDbContext).clearDefault()).resolves.toBeUndefined();
  });
});
