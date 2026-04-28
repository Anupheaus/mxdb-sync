import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUseRecords } from './createUseRecords';

const mockQuery = vi.fn();
const mockGetAll = vi.fn();
const mockUpsert = vi.fn();
const mockRemove = vi.fn();
const mockGet = vi.fn();
const mockFind = vi.fn();
const mockDistinct = vi.fn();

vi.mock('../../collections/useCollection', () => ({
  useCollection: () => ({
    query: mockQuery,
    getAll: mockGetAll,
    upsert: mockUpsert,
    remove: mockRemove,
    get: mockGet,
    find: mockFind,
    distinct: mockDistinct,
  }),
}));

describe('createUseRecords (server)', () => {
  const collection = { name: 'orders', type: {} as any };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ records: [], total: 0 });
  });

  it('returns named action functions', () => {
    const useOrders = createUseRecords('orders', collection);
    const result = useOrders();
    expect(typeof result.queryOrders).toBe('function');
    expect(typeof result.upsertOrders).toBe('function');
    expect(typeof result.removeOrders).toBe('function');
    expect(typeof result.getOrders).toBe('function');
    expect(typeof result.getAllOrders).toBe('function');
    expect(typeof result.findOrders).toBe('function');
    expect(typeof result.distinctOrders).toBe('function');
  });

  it('query helper with no args calls underlying query with empty props', async () => {
    const useOrders = createUseRecords('orders', collection);
    await useOrders.query();
    expect(mockQuery).toHaveBeenCalledWith({});
  });

  it('query helper returns named records and total', async () => {
    mockQuery.mockResolvedValue({ records: [{ id: '1', name: 'A' }], total: 3 });
    const useOrders = createUseRecords('orders', collection);
    const result = await useOrders.query();
    expect(result.orders).toEqual([{ id: '1', name: 'A' }]);
    expect(result.totalOrders).toBe(3);
  });

  it('query helper with ids builds $in filter', async () => {
    const useOrders = createUseRecords('orders', collection);
    await useOrders.query([{ id: '1' } as any, '2']);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { id: { $in: ['1', '2'] } } }),
    );
  });

  it('query helper with QueryProps passes them through', async () => {
    const useOrders = createUseRecords('orders', collection);
    await useOrders.query({ filters: { status: 'active' } as any });
    expect(mockQuery).toHaveBeenCalledWith({ filters: { status: 'active' } });
  });

  it('merges additionalQueryProps into id-based query', async () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { sorts: [{ field: 'name' as any, direction: 'asc' }] },
    });
    await useOrders.query(['1']);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sorts: [{ field: 'name', direction: 'asc' }] }),
    );
  });

  it('handles dasherized names', async () => {
    const useOrderItems = createUseRecords('order-items', collection);
    const result = await useOrderItems.query();
    expect(result).toHaveProperty('orderItems');
    expect(result).toHaveProperty('totalOrderItems');
  });

  it('merges helper results into the returned object', () => {
    const useOrders = createUseRecords('orders', collection, {
      helpers: () => ({ isAdmin: true }),
    });
    const result = useOrders();
    expect((result as any).isAdmin).toBe(true);
  });

  it('passes base result context to helpers', () => {
    const helpersFn = vi.fn().mockReturnValue({});
    const useOrders = createUseRecords('orders', collection, { helpers: helpersFn });
    useOrders();
    expect(helpersFn).toHaveBeenCalledWith(
      expect.objectContaining({ queryOrders: expect.any(Function), upsertOrders: expect.any(Function) }),
    );
  });

  it('attaches extensions as static methods', () => {
    const staticFn = vi.fn().mockReturnValue('hello');
    const useOrders = createUseRecords('orders', collection, {
      extensions: { getDefault: staticFn },
    });
    expect(typeof (useOrders as any).getDefault).toBe('function');
    (useOrders as any).getDefault();
    expect(staticFn).toHaveBeenCalled();
  });

  it('merges additionalQueryProps into no-args query', async () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { sorts: [{ field: 'name' as any, direction: 'asc' }] },
    });
    await useOrders.query();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sorts: [{ field: 'name', direction: 'asc' }] }),
    );
  });

  it('caller QueryProps win over additionalQueryProps', async () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { sorts: [{ field: 'name' as any, direction: 'asc' }] },
    });
    await useOrders.query({ sorts: [{ field: 'createdAt' as any, direction: 'desc' }] });
    expect(mockQuery).toHaveBeenCalledWith({
      sorts: [{ field: 'createdAt', direction: 'desc' }],
    });
  });

  it('computed $in filter is not clobbered by additionalQueryProps.filters', async () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { filters: { status: 'active' } as any },
    });
    await useOrders.query(['1', '2']);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { id: { $in: ['1', '2'] } } }),
    );
  });
});
