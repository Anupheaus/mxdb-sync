import { describe, expect, it, vi } from 'vitest';
import type { Record } from '@anupheaus/common';
import { createFind } from './createFind';
import type { Query } from './createQuery';

interface Row extends Record {
  id: string;
  name: string;
}

describe('createFind', () => {
  it('returns the full query result when no onResponse callback is passed', async () => {
    const query = vi.fn(
      async (): Promise<{ records: Row[]; total: number }> =>
        ({ records: [{ id: '1', name: 'first' }], total: 1 }),
    ) as unknown as Query<Row>;

    const find = createFind(query);
    const result = await find({});
    expect(query).toHaveBeenCalledWith({ filters: {} });
    expect(result).toBeDefined();
    expect(result!.records[0]).toEqual({ id: '1', name: 'first' });
    expect(result!.total).toBe(1);
  });

  it('invokes onResponse with the first record when provided', async () => {
    const query = vi.fn((_props: { filters: object }, onResponse?: (r: { records: Row[]; total: number }) => void) => {
      if (onResponse) {
        onResponse({ records: [{ id: '2', name: 'second' }], total: 1 });
        return Promise.resolve();
      }
      return Promise.resolve({ records: [], total: 0 });
    }) as unknown as Query<Row>;

    const find = createFind(query);
    const onResponse = vi.fn();
    await find({}, onResponse);
    expect(onResponse).toHaveBeenCalledWith({ id: '2', name: 'second' });
  });

  it('does not call onResponse when the query returns no rows', async () => {
    const query = vi.fn((_props: { filters: object }, onResponse?: (r: { records: Row[]; total: number }) => void) => {
      if (onResponse) {
        onResponse({ records: [], total: 0 });
        return Promise.resolve();
      }
      return Promise.resolve({ records: [], total: 0 });
    }) as unknown as Query<Row>;

    const find = createFind(query);
    const onResponse = vi.fn();
    await find({}, onResponse);
    expect(onResponse).not.toHaveBeenCalled();
  });
});
