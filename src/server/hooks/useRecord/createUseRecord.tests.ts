import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUseRecord } from './createUseRecord';

const mockGet = vi.fn();
const mockUpsert = vi.fn();
const mockRemove = vi.fn();

vi.mock('../../collections/useCollection', () => ({
  useCollection: () => ({
    get: mockGet,
    upsert: mockUpsert,
    remove: mockRemove,
  }),
}));

describe('createUseRecord (server)', () => {
  const collection = { name: 'orders', type: {} as any };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
  });

  it('calls hydrateRecord with the loaded record', async () => {
    const hydrateRecord = vi.fn().mockImplementation((r: any) => r ?? { id: '', name: 'New' });
    const useOrder = createUseRecord('order', collection, { hydrateRecord });
    const existing = { id: '1', name: 'Existing' };
    mockGet.mockResolvedValue(existing);
    await useOrder('1');
    expect(hydrateRecord).toHaveBeenCalledWith(existing);
  });

  it('calls hydrateRecord with undefined when id is undefined', async () => {
    const hydrateRecord = vi.fn().mockReturnValue({ id: '', name: 'New' });
    const useOrder = createUseRecord('order', collection, { hydrateRecord });
    await useOrder(undefined);
    expect(mockGet).not.toHaveBeenCalled();
    expect(hydrateRecord).toHaveBeenCalledWith(undefined);
  });

  it('isNewOrder is true when record not found', async () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r ?? { id: '', name: 'New' },
    });
    const result = await useOrder('missing-id');
    expect(result.isNewOrder).toBe(true);
  });

  it('isNewOrder is false when record exists', async () => {
    mockGet.mockResolvedValue({ id: '1', name: 'Existing' });
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r!,
    });
    const result = await useOrder('1');
    expect(result.isNewOrder).toBe(false);
  });

  it('stamps id onto the hydrated record', async () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: () => ({ id: '', name: 'New' }),
    });
    const result = await useOrder('target-id');
    expect(result.order?.id).toBe('target-id');
  });

  it('removeOrder calls remove with the hydrated record', async () => {
    const existing = { id: '1', name: 'Existing' };
    mockGet.mockResolvedValue(existing);
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r!,
    });
    const result = await useOrder('1');
    await result.removeOrder();
    expect(mockRemove).toHaveBeenCalledWith(existing);
  });

  it('removeOrder returns false when record is undefined', async () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: () => undefined as any,
    });
    const result = await useOrder('1');
    const removed = await result.removeOrder();
    expect(removed).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('merges helper results into the returned object', async () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r ?? { id: '', name: 'New' },
      helpers: (ctx) => ({ isSpecial: ctx.order?.name === 'Special' }),
    });
    mockGet.mockResolvedValue({ id: '1', name: 'Special' });
    const result = await useOrder('1');
    expect((result as any).isSpecial).toBe(true);
  });

  it('attaches extensions as static methods', () => {
    const staticFn = vi.fn().mockReturnValue('hello');
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r ?? { id: '', name: '' },
      extensions: { getDefault: staticFn },
    });
    expect(typeof (useOrder as any).getDefault).toBe('function');
    (useOrder as any).getDefault();
    expect(staticFn).toHaveBeenCalled();
  });
});
