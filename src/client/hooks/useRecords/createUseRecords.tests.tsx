// @vitest-environment jsdom
import '@anupheaus/common';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createUseRecords } from './createUseRecords';

const mockUpsert = vi.fn();
const mockRemove = vi.fn();
const mockQuery = vi.fn();
const mockGet = vi.fn();
const mockUseQuery = vi.fn();

vi.mock('../useCollection/useCollection', () => ({
  useCollection: () => ({
    upsert: mockUpsert,
    remove: mockRemove,
    query: mockQuery,
    get: mockGet,
    useQuery: mockUseQuery,
  }),
}));

/**
 * Minimal renderHook-style helper using createRoot + act.
 * Returns the latest value exposed by the hook via a ref, and an unmount function.
 */
function renderHook<T>(useHook: () => T): { result: { current: T }; unmount: () => void } {
  let container: HTMLDivElement | null = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  const result = { current: undefined as unknown as T };

  function Probe() {
    result.current = useHook();
    return null;
  }

  act(() => {
    root = createRoot(container!);
    root.render(<Probe />);
  });

  function unmount() {
    act(() => {
      root?.unmount();
      root = null;
    });
    container?.remove();
    container = null;
  }

  return { result, unmount };
}

describe('createUseRecords (client)', () => {
  const collection = { name: 'orders', type: {} as any };

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ records: [], isLoading: false, total: 0 });
  });

  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  // ─── Main hook: named function exposure ──────────────────────────────────

  it('returns named upsert, remove, query, and get functions', () => {
    const useOrders = createUseRecords('orders', collection);
    const { result, unmount: u } = renderHook(() => useOrders());
    unmount = u;
    expect(typeof result.current.upsertOrders).toBe('function');
    expect(typeof result.current.removeOrders).toBe('function');
    expect(typeof result.current.queryOrders).toBe('function');
    expect(typeof result.current.getOrders).toBe('function');
  });

  it('named functions delegate to the underlying useCollection methods', () => {
    const useOrders = createUseRecords('orders', collection);
    const { result, unmount: u } = renderHook(() => useOrders());
    unmount = u;
    result.current.upsertOrders({ id: 'r1' } as any);
    expect(mockUpsert).toHaveBeenCalledWith({ id: 'r1' });
    result.current.removeOrders([{ id: 'r1' }] as any);
    expect(mockRemove).toHaveBeenCalledWith([{ id: 'r1' }]);
  });

  // ─── Query sub-hook: named return fields ─────────────────────────────────

  it('query hook returns named records, isLoading, and total', () => {
    mockUseQuery.mockReturnValue({ records: [{ id: '1' }], isLoading: true, total: 5 });
    const useOrders = createUseRecords('orders', collection);
    const { result, unmount: u } = renderHook(() => useOrders.query());
    unmount = u;
    expect(result.current.orders).toEqual([{ id: '1' }]);
    expect(result.current.isLoadingOrders).toBe(true);
    expect(result.current.totalOrders).toBe(5);
  });

  it('query hook with no args passes empty props to useQuery', () => {
    const useOrders = createUseRecords('orders', collection);
    renderHook(() => useOrders.query());
    expect(mockUseQuery).toHaveBeenCalledWith({});
  });

  // ─── Query sub-hook: id-based overload ───────────────────────────────────

  it('query hook with record objects builds $in filter from their ids', () => {
    const useOrders = createUseRecords('orders', collection);
    renderHook(() => useOrders.query([{ id: '1' } as any, { id: '2' } as any]));
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { id: { $in: ['1', '2'] } } }),
    );
  });

  it('query hook with string ids builds $in filter', () => {
    const useOrders = createUseRecords('orders', collection);
    renderHook(() => useOrders.query([{ id: '1' } as any, '2']));
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { id: { $in: ['1', '2'] } } }),
    );
  });

  it('query hook with empty ids array sets disable: true', () => {
    const useOrders = createUseRecords('orders', collection);
    renderHook(() => useOrders.query([]));
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ disable: true }),
    );
  });

  // ─── Query sub-hook: QueryProps overload ─────────────────────────────────

  it('query hook with QueryProps passes them through', () => {
    const useOrders = createUseRecords('orders', collection);
    renderHook(() => useOrders.query({ filters: { status: 'active' } as any }));
    expect(mockUseQuery).toHaveBeenCalledWith({ filters: { status: 'active' } });
  });

  it('query hook with disable: true passes it through', () => {
    const useOrders = createUseRecords('orders', collection);
    renderHook(() => useOrders.query({ disable: true }));
    expect(mockUseQuery).toHaveBeenCalledWith({ disable: true });
  });

  // ─── Dasherized collection names ─────────────────────────────────────────

  it('handles dasherized names — camelCase field, PascalCase suffix', () => {
    const useOrderItems = createUseRecords('order-items', collection);
    const { result, unmount: u } = renderHook(() => useOrderItems.query());
    unmount = u;
    expect(result.current).toHaveProperty('orderItems');
    expect(result.current).toHaveProperty('isLoadingOrderItems');
    expect(result.current).toHaveProperty('totalOrderItems');
  });

  it('handles dasherized names on the main hook', () => {
    const useOrderItems = createUseRecords('order-items', collection);
    const { result, unmount: u } = renderHook(() => useOrderItems());
    unmount = u;
    expect(typeof result.current.upsertOrderItems).toBe('function');
    expect(typeof result.current.removeOrderItems).toBe('function');
    expect(typeof result.current.queryOrderItems).toBe('function');
    expect(typeof result.current.getOrderItems).toBe('function');
  });

  // ─── additionalQueryProps ─────────────────────────────────────────────────

  it('merges additionalQueryProps into id-based query', () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { sorts: [{ field: 'name' as any, direction: 'asc' }] },
    });
    renderHook(() => useOrders.query(['1']));
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sorts: [{ field: 'name', direction: 'asc' }] }),
    );
  });

  it('merges additionalQueryProps into no-args query', () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { sorts: [{ field: 'name' as any, direction: 'desc' }] },
    });
    renderHook(() => useOrders.query());
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sorts: [{ field: 'name', direction: 'desc' }] }),
    );
  });

  it('merges additionalQueryProps as defaults when QueryProps are passed explicitly', () => {
    const useOrders = createUseRecords('orders', collection, {
      additionalQueryProps: { sorts: [{ field: 'name' as any, direction: 'asc' }] },
    });
    renderHook(() => useOrders.query({ filters: { status: 'active' } as any }));
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { status: 'active' },
        sorts: [{ field: 'name', direction: 'asc' }],
      }),
    );
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  it('merges helpers into the main hook result', () => {
    const useOrders = createUseRecords('orders', collection, {
      helpers: () => ({ isSpecial: true }),
    });
    const { result, unmount: u } = renderHook(() => useOrders());
    unmount = u;
    expect((result.current as any).isSpecial).toBe(true);
  });

  // ─── Extensions ──────────────────────────────────────────────────────────

  it('attaches extensions as static methods on the hook', () => {
    const staticHelper = vi.fn().mockReturnValue('hello');
    const useOrders = createUseRecords('orders', collection, {
      extensions: { getDefault: staticHelper },
    });
    expect(typeof (useOrders as any).getDefault).toBe('function');
    (useOrders as any).getDefault();
    expect(staticHelper).toHaveBeenCalled();
  });
});
