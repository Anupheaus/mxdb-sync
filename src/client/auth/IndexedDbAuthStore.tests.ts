import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbAuthStore, isIndexedDbAvailable, type MXDBAuthEntry } from './IndexedDbAuthStore';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<MXDBAuthEntry> = {}): MXDBAuthEntry {
  return {
    id: 'test-id',
    credentialId: new Uint8Array([1, 2, 3]),
    dbName: 'test-db',
    isDefault: true,
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('isIndexedDbAvailable', () => {
  it('returns true when indexedDB is present (fake-indexeddb installed by setup)', () => {
    // The global test setup installs fake-indexeddb, so IDB is always available in tests.
    expect(isIndexedDbAvailable()).toBe(true);
  });

  it('returns false when indexedDB is not defined on globalThis', () => {
    const original = (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).indexedDB;
    try {
      expect(isIndexedDbAvailable()).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>).indexedDB = original;
    }
  });
});

describe('IndexedDbAuthStore — when IndexedDB is unavailable', () => {
  let savedIdb: unknown;

  beforeEach(() => {
    savedIdb = (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).indexedDB;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = savedIdb;
  });

  it('getDefault returns undefined', async () => {
    const result = await IndexedDbAuthStore.getDefault('test-app');
    expect(result).toBeUndefined();
  });

  it('getAll returns an empty array', async () => {
    const result = await IndexedDbAuthStore.getAll('test-app');
    expect(result).toEqual([]);
  });

  it('save resolves without throwing', async () => {
    const entry = makeEntry();
    await expect(IndexedDbAuthStore.save('test-app', entry)).resolves.toBeUndefined();
  });

  it('clearAllDefaults resolves without throwing', async () => {
    await expect(IndexedDbAuthStore.clearAllDefaults('test-app')).resolves.toBeUndefined();
  });
});

describe('IndexedDbAuthStore — when IndexedDB is available (fake-indexeddb)', () => {
  // Each test uses a unique app name so IndexedDB stores don't bleed across tests.
  let appName: string;
  let counter = 0;

  beforeEach(() => {
    appName = `test-app-${++counter}`;
  });

  it('getDefault returns undefined when no entries exist', async () => {
    const result = await IndexedDbAuthStore.getDefault(appName);
    expect(result).toBeUndefined();
  });

  it('getAll returns an empty array when no entries exist', async () => {
    const result = await IndexedDbAuthStore.getAll(appName);
    expect(result).toEqual([]);
  });

  it('save persists an entry and getDefault retrieves it', async () => {
    const entry = makeEntry({ id: 'user-1', dbName: 'db-1', isDefault: true });
    await IndexedDbAuthStore.save(appName, entry);

    const defaultEntry = await IndexedDbAuthStore.getDefault(appName);
    expect(defaultEntry).toBeDefined();
    expect(defaultEntry?.id).toBe('user-1');
    expect(defaultEntry?.isDefault).toBe(true);
  });

  it('save clears isDefault on all existing entries and sets the new entry as default', async () => {
    const entryA = makeEntry({ id: 'user-a', dbName: 'db-a', isDefault: true });
    await IndexedDbAuthStore.save(appName, entryA);

    const entryB = makeEntry({ id: 'user-b', dbName: 'db-b', isDefault: true });
    await IndexedDbAuthStore.save(appName, entryB);

    const all = await IndexedDbAuthStore.getAll(appName);
    const defaults = all.filter(e => e.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('user-b');
  });

  it('getAll returns all saved entries', async () => {
    await IndexedDbAuthStore.save(appName, makeEntry({ id: 'u1', dbName: 'db1', isDefault: true }));
    await IndexedDbAuthStore.save(appName, makeEntry({ id: 'u2', dbName: 'db2', isDefault: true }));

    const all = await IndexedDbAuthStore.getAll(appName);
    expect(all).toHaveLength(2);
    const ids = all.map(e => e.id).sort();
    expect(ids).toEqual(['u1', 'u2']);
  });

  it('clearAllDefaults sets isDefault to false on all entries', async () => {
    await IndexedDbAuthStore.save(appName, makeEntry({ id: 'u1', dbName: 'db1', isDefault: true }));

    await IndexedDbAuthStore.clearAllDefaults(appName);

    const all = await IndexedDbAuthStore.getAll(appName);
    expect(all.every(e => !e.isDefault)).toBe(true);

    const def = await IndexedDbAuthStore.getDefault(appName);
    expect(def).toBeUndefined();
  });

  it('save forces isDefault: true even when entry has isDefault: false', async () => {
    const entry: MXDBAuthEntry = {
      id: 'force-id',
      credentialId: new Uint8Array([9, 8, 7]),
      dbName: 'force-db',
      isDefault: false, // caller passes false
    };
    await IndexedDbAuthStore.save(appName, entry);
    const result = await IndexedDbAuthStore.getDefault(appName);
    // save() must always set isDefault: true regardless of input
    expect(result).toBeDefined();
    expect(result!.id).toBe('force-id');
    expect(result!.isDefault).toBe(true);
  });
});

describe('MXDBAuthEntry type shape', () => {
  it('does not include token or keyHash fields (compile-time check)', () => {
    // If this satisfies expression compiles, the type does not require token or keyHash.
    const entry = {
      id: 'id',
      credentialId: new Uint8Array(0),
      dbName: 'db',
      isDefault: false,
    } satisfies MXDBAuthEntry;

    expect(entry).toBeDefined();
    expect('token' in entry).toBe(false);
    expect('keyHash' in entry).toBe(false);
  });
});
