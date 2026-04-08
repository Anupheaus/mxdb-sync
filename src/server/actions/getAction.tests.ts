import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGet } from './getAction';

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

describe('handleGet', () => {
  const collection = { name: 'items' };
  const mockGet = vi.fn();
  const mockDbCollection = { collection, get: mockGet };
  const mockPushRecordsToClient = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSync.mockReturnValue({ pushRecordsToClient: mockPushRecordsToClient });
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: false });
  });

  it('returns empty array when get returns null or empty', async () => {
    mockGet.mockResolvedValue(null);
    expect(await handleGet({ collectionName: 'items', ids: ['1'] })).toEqual([]);
    mockGet.mockResolvedValue([]);
    expect(await handleGet({ collectionName: 'items', ids: ['1'] })).toEqual([]);
  });

  it('calls pushRecordsToClient and returns ids (audited collection)', async () => {
    const records = withIds([{ id: '1', name: 'a' }, { id: '2', name: 'b' }]);
    mockGet.mockResolvedValue(records);
    const result = await handleGet({ collectionName: 'items', ids: ['1', '2'] });
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1', '2'], [], false);
    expect(result).toEqual(['1', '2']);
  });

  it('passes disableAudit true for audit-free collections', async () => {
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: true });
    const records = withIds([{ id: '1' }]);
    mockGet.mockResolvedValue(records);
    await handleGet({ collectionName: 'items', ids: ['1'] });
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1'], [], true);
  });

  it('does not call configRegistry when no records returned', async () => {
    mockGet.mockResolvedValue([]);
    await handleGet({ collectionName: 'items', ids: [] });
    expect(mockConfigRegistryGetOrError).not.toHaveBeenCalled();
  });
});
