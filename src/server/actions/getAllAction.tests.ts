import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAll } from './getAllAction';

function withIds<T extends { id: string }>(items: T[]): T[] & { ids: () => string[] } {
  return Object.assign(items, { ids: () => items.map(r => r.id) });
}

const mockUseDb = vi.fn();
const mockUseServerToClientSync = vi.fn();
const mockConfigRegistryGetOrError = vi.fn();

vi.mock('../providers', () => ({
  useDb: () => mockUseDb(),
  useServerToClientSync: () => mockUseServerToClientSync(),
}));
vi.mock('../../common', async importOriginal => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    configRegistry: {
      ...(actual as any).configRegistry,
      getOrError: (...args: unknown[]) => mockConfigRegistryGetOrError(...args),
    },
  };
});

describe('handleGetAll', () => {
  const collection = { name: 'items' };
  const mockGetAll = vi.fn();
  const mockDbCollection = { collection, getAll: mockGetAll };
  const mockPushRecordsToClient = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSync.mockReturnValue({ pushRecordsToClient: mockPushRecordsToClient });
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: false });
  });

  it('returns empty array when collection has no records', async () => {
    mockGetAll.mockResolvedValue([]);
    const result = await handleGetAll({ collectionName: 'items' });
    expect(result).toEqual([]);
    expect(mockPushRecordsToClient).not.toHaveBeenCalled();
  });

  it('calls pushRecordsToClient and returns record ids', async () => {
    const records = withIds([{ id: '1', name: 'a' }]);
    mockGetAll.mockResolvedValue(records);
    const result = await handleGetAll({ collectionName: 'items' });
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1'], [], false);
    expect(result).toEqual(['1']);
  });

  it('passes disableAudit true for audit-free collections', async () => {
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: true });
    const records = withIds([{ id: '1' }]);
    mockGetAll.mockResolvedValue(records);
    await handleGetAll({ collectionName: 'items' });
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1'], [], true);
  });

  it('does not call configRegistry when no records returned', async () => {
    mockGetAll.mockResolvedValue([]);
    await handleGetAll({ collectionName: 'items' });
    expect(mockConfigRegistryGetOrError).not.toHaveBeenCalled();
  });
});
