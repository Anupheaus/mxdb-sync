import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addClientWatches, removeClientWatches } from './clientDbWatches';

const mockUseDb = vi.fn();
const mockUseClient = vi.fn();

vi.mock('./providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('./hooks', () => ({ useClient: () => mockUseClient() }));

describe('clientDbWatches', () => {
  const mockOnChange = vi.fn();
  const mockDb = { onChange: mockOnChange };
  const mockSyncRecords = vi.fn();
  const collections = [{ name: 'items' }];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue(mockDb);
    mockUseClient.mockReturnValue({ syncRecords: mockSyncRecords });
    mockOnChange.mockReturnValue(() => {});
  });

  it('addClientWatches subscribes to db.onChange and ignores duplicate calls for same client', () => {
    const client = {} as any;
    addClientWatches(client, collections);
    addClientWatches(client, collections);
    expect(mockOnChange).toHaveBeenCalledTimes(1);
  });

  it('onChange callback calls syncRecords for insert/update event when collection found', async () => {
    let onChangeCb: ((event: any) => void) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => void) => {
      onChangeCb = cb;
      return () => {};
    });
    const client = {} as any;
    addClientWatches(client, collections);
    expect(onChangeCb).not.toBeNull();
    await onChangeCb!({ collectionName: 'items', type: 'insert', records: [{ id: '1' }] });
    expect(mockSyncRecords).toHaveBeenCalledWith({ name: 'items' }, [{ id: '1' }], []);
  });

  it('onChange callback calls syncRecords for delete event', async () => {
    let onChangeCb: ((event: any) => void) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => void) => {
      onChangeCb = cb;
      return () => {};
    });
    const client = {} as any;
    addClientWatches(client, collections);
    await onChangeCb!({ collectionName: 'items', type: 'delete', recordIds: ['1', '2'] });
    expect(mockSyncRecords).toHaveBeenCalledWith({ name: 'items' }, [], ['1', '2']);
  });

  it('onChange callback does nothing when collection not found', async () => {
    let onChangeCb: ((event: any) => void) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => void) => {
      onChangeCb = cb;
      return () => {};
    });
    const client = {} as any;
    addClientWatches(client, collections);
    await onChangeCb!({ collectionName: 'other', type: 'insert', records: [] });
    expect(mockSyncRecords).not.toHaveBeenCalled();
  });

  it('removeClientWatches unsubscribes and removes client', () => {
    const unsubscribe = vi.fn();
    mockOnChange.mockReturnValue(unsubscribe);
    const client = {} as any;
    addClientWatches(client, collections);
    removeClientWatches(client);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const client2 = {} as any;
    addClientWatches(client2, collections);
    expect(mockOnChange).toHaveBeenCalledTimes(2);
  });
});
