import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditEntryType, type MXDBCollection } from '../common';
import { addClientWatches, removeClientWatches } from './clientDbWatches';

function mockAuditDoc(recordId: string, entryId: string) {
  return {
    id: recordId,
    entries: [{
      id: entryId,
      type: AuditEntryType.Created,
      record: { id: recordId },
    }],
  };
}

const mockUseDb = vi.fn();
const mockConfigRegistryGetOrError = vi.fn();

vi.mock('./providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('../common', async importOriginal => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    configRegistry: {
      ...(actual as any).configRegistry,
      getOrError: (...args: unknown[]) => mockConfigRegistryGetOrError(...args),
    },
  };
});
vi.mock('../common/auditor/hash', () => ({
  hashRecord: vi.fn().mockResolvedValue('mock-hash'),
}));

describe('clientDbWatches', () => {
  const mockOnChange = vi.fn();
  const mockGetAudit = vi.fn();
  const mockUse = vi.fn();
  const mockDb = { onChange: mockOnChange, use: mockUse };
  const mockOnDbChange = vi.fn().mockResolvedValue(undefined);
  const mockS2c = { onDbChange: mockOnDbChange };
  const collection: MXDBCollection = { name: 'items', type: null as never };
  const collections: MXDBCollection[] = [collection];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAudit.mockResolvedValue([]);
    mockUse.mockReturnValue({ getAudit: mockGetAudit });
    mockUseDb.mockReturnValue(mockDb);
    mockOnChange.mockReturnValue(() => {});
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: false });
  });

  it('addClientWatches subscribes to db.onChange and ignores duplicate calls for same client', () => {
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    addClientWatches(client, collections, mockS2c as any);
    expect(mockOnChange).toHaveBeenCalledTimes(1);
  });

  it('onChange callback calls s2c.onDbChange for insert event on audited collection', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => {};
    });
    const records = [{ id: '1' }];
    mockGetAudit.mockResolvedValue([mockAuditDoc('1', 'e1')]);

    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'items', type: 'insert', records });
    expect(mockOnDbChange).toHaveBeenCalledOnce();
    const [collectionName, changes] = mockOnDbChange.mock.calls[0] as [string, Array<{ recordId: string; record: object }>];
    expect(collectionName).toBe('items');
    expect(changes[0].recordId).toBe('1');
    expect(changes[0].record).toEqual(records[0]);
  });

  it('onChange callback calls s2c.onDbChange for insert on audit-free collection', async () => {
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: true });
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => {};
    });
    const records = [{ id: '1' }];
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'items', type: 'insert', records });
    expect(mockOnDbChange).toHaveBeenCalledOnce();
  });

  it('onChange callback calls s2c.onDbChange with deleted rows for delete event', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => {};
    });
    const client = {} as any;
    addClientWatches(client, collections, mockS2c as any);
    await onChangeCb!({ collectionName: 'items', type: 'delete', recordIds: ['1', '2'] });
    expect(mockOnDbChange).toHaveBeenCalledOnce();
    const [, changes] = mockOnDbChange.mock.calls[0] as [string, Array<{ recordId: string; deleted?: boolean }>];
    expect(changes.map(c => c.recordId).sort()).toEqual(['1', '2']);
    expect(changes.every(c => c.deleted === true)).toBe(true);
  });

  it('onChange callback does nothing when collection not found', async () => {
    let onChangeCb: ((event: any) => Promise<void>) | null = null;
    mockOnChange.mockImplementation((cb: (event: any) => Promise<void>) => {
      onChangeCb = cb;
      return () => {};
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
