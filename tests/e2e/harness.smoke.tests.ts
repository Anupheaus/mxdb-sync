import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetE2E, setupE2E, teardownE2E, useClient, useServer } from './setup';

describe('e2e setup harness (smoke)', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  it('useServer + useClient: one upsert appears in Mongo', async () => {
    const client = useClient('a');
    await client.connect();
    const id = `e2e-smoke-${Date.now()}`;
    await client.upsert({
      id,
      clientId: 'a',
      value: 'smoke',
    });
    const server = useServer();
    await server.waitForLiveRecord(id);
    const rows = await server.readLiveRecords();
    expect(rows.some(r => r.id === id)).toBe(true);
  }, 60_000);
});
