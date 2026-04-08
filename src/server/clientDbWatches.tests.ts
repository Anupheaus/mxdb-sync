import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MXDBCollection } from '../common';
import { addClientWatches, removeClientWatches } from './clientDbWatches';

const mockUseDb = vi.fn();

vi.mock('./providers', () => ({ useDb: () => mockUseDb() }));

describe('clientDbWatches', () => {
  const mockOnChange = vi.fn();
  const mockDb = { onChange: mockOnChange };
  const mockOnDbChange = vi.fn().mockResolvedValue(undefined);
  const mockS2c = { onDbChange: mockOnDbChange };
  const collection: MXDBCollection = { name: 'items', type: null as never };
  const collections: MXDBCollection[] = [collection];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue(mockDb);
    mockOnChange.mockReturnValue(() => { });
  });

  it('addClientWatches subscribes to db.onChange and ignores duplicate calls for same client', () => {
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    addClientWatches(client, collections, mockS2c as any);
    expect(mockOnChange).toHaveBeenCalledTimes(1);
  });

  it('onChange callback forwards insert event as upsert to s2c.onDbChange', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => { };
    });
    const records = [{ id: '1' }];
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'items', type: 'insert', records });
    expect(mockOnDbChange).toHaveBeenCalledOnce();
    expect(mockOnDbChange).toHaveBeenCalledWith({ type: 'upsert', collectionName: 'items', records });
  });

  it('onChange callback forwards update event as upsert to s2c.onDbChange', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => { };
    });
    const records = [{ id: '1' }];
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'items', type: 'update', records });
    expect(mockOnDbChange).toHaveBeenCalledOnce();
    expect(mockOnDbChange).toHaveBeenCalledWith({ type: 'upsert', collectionName: 'items', records });
  });

  it('onChange callback forwards delete event with recordIds to s2c.onDbChange', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => { };
    });
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'items', type: 'delete', recordIds: ['1', '2'] });
    expect(mockOnDbChange).toHaveBeenCalledOnce();
    expect(mockOnDbChange).toHaveBeenCalledWith({ type: 'delete', collectionName: 'items', recordIds: ['1', '2'] });
  });

  it('onChange callback does nothing when collection not found', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => { };
    });
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'other', type: 'insert', records: [] });
    expect(mockOnDbChange).not.toHaveBeenCalled();
  });

  it('removeClientWatches unsubscribes and removes client', () => {
    const unsubscribe = vi.fn();
    mockOnChange.mockReturnValue(unsubscribe);
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    removeClientWatches(client);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const client2 = {} as any;
    addClientWatches(client2, collections, mockS2c as any);
    expect(mockOnChange).toHaveBeenCalledTimes(2);
  });
});
