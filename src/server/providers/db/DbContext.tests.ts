import { describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '@anupheaus/common';
import { setDb, setServerToClientSync, useDb, useServerToClientSynchronisation } from './DbContext';
import type { ServerDb } from './ServerDb';
import { ServerToClientSynchronisation } from '../../ServerToClientSynchronisation';

describe('DbContext', () => {
  const fakeDb = { isFakeDb: true } as unknown as ServerDb;

  beforeEach(() => {
    setDb(fakeDb);
    setServerToClientSync(ServerToClientSynchronisation.createNoOp([], new Logger('test')));
  });

  it('useDb returns the db set by setDb', () => {
    expect(useDb()).toBe(fakeDb);
  });

  it('useServerToClientSynchronisation returns the S2C instance', () => {
    const s2c = useServerToClientSynchronisation();
    expect(s2c).toBeInstanceOf(ServerToClientSynchronisation);
  });

  it('useDb returns the same db from within an async handler', async () => {
    const result = await Promise.resolve().then(() => useDb());
    expect(result).toBe(fakeDb);
  });

  it('useDb returns the same db from within a nested async callback', async () => {
    const result = await new Promise<ServerDb>(resolve => {
      setTimeout(() => resolve(useDb()), 0);
    });
    expect(result).toBe(fakeDb);
  });
});
