// @vitest-environment jsdom
import '@anupheaus/common';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createUseRecord } from './createUseRecord';

const mockUpsert = vi.fn();
const mockRemove = vi.fn();

vi.mock('../../useRecord', () => ({
  useRecord: vi.fn(() => ({
    record: undefined,
    isLoading: false,
    upsert: vi.fn(),
    remove: vi.fn(),
  })),
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

describe('createUseRecord (client)', () => {
  const collection = { name: 'orders', type: {} as any };

  beforeEach(() => vi.clearAllMocks());

  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it('hydrates a new record when createNew is true', () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: () => ({ id: 'new-id', name: 'New Order' }),
    });
    const { result, unmount: u } = renderHook(() => useOrder(undefined, true));
    unmount = u;
    expect(result.current.order).toMatchObject({ name: 'New Order' });
    expect(result.current.isNewOrder).toBe(true);
  });

  it('returns named upsert, remove, set, and autoSave functions', () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r ?? { id: '', name: '' },
    });
    const { result, unmount: u } = renderHook(() => useOrder(undefined));
    unmount = u;
    expect(typeof result.current.upsertOrder).toBe('function');
    expect(typeof result.current.removeOrder).toBe('function');
    expect(typeof result.current.setOrder).toBe('function');
    expect(typeof result.current.autoSaveOrder).toBe('function');
    expect(typeof result.current.isLoadingOrder).toBe('boolean');
    expect(typeof result.current.isNewOrder).toBe('boolean');
  });

  it('attaches extensions as static methods', () => {
    const staticHelper = vi.fn().mockReturnValue('hello');
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r ?? { id: '', name: '' },
      extensions: { getDefault: staticHelper },
    });
    expect(typeof (useOrder as any).getDefault).toBe('function');
    (useOrder as any).getDefault();
    expect(staticHelper).toHaveBeenCalled();
  });

  it('merges helpers into the result', () => {
    const useOrder = createUseRecord('order', collection, {
      hydrateRecord: (r) => r ?? { id: '', name: '' },
      helpers: () => ({ isSpecial: true }),
    });
    const { result, unmount: u } = renderHook(() => useOrder(undefined));
    unmount = u;
    expect((result.current as any).isSpecial).toBe(true);
  });
});
