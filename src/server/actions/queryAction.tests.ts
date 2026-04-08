import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQuery } from './queryAction';

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

describe('handleQuery', () => {
  const collection = { name: 'items' };
  const mockQuery = vi.fn();
  const mockDbCollection = { collection, query: mockQuery };
  const mockPushRecordsToClient = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSync.mockReturnValue({ pushRecordsToClient: mockPushRecordsToClient });
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: false });
  });

  it('returns empty array when query returns no records', async () => {
    mockQuery.mockResolvedValue({ data: [], total: 0 });
    const result = await handleQuery({ collectionName: 'items' });
    expect(result).toEqual([]);
  });

  it('calls pushRecordsToClient and returns total', async () => {
    const records = withIds([{ id: '1', name: 'a' }]);
    mockQuery.mockResolvedValue({ data: records, total: 1 });
    const result = await handleQuery({ collectionName: 'items' });
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1'], [], false);
    expect(result).toBe(1);
  });

  it('passes disableAudit true for audit-free collections', async () => {
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: true });
    const records = withIds([{ id: '1' }]);
    mockQuery.mockResolvedValue({ data: records, total: 1 });
    await handleQuery({ collectionName: 'items' });
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1'], [], true);
  });

  it('does not call configRegistry when no records returned', async () => {
    mockQuery.mockResolvedValue({ data: [], total: 0 });
    await handleQuery({ collectionName: 'items' });
    expect(mockConfigRegistryGetOrError).not.toHaveBeenCalled();
  });

  it('passes extra query parameters to dbCollection.query', async () => {
    mockQuery.mockResolvedValue({ data: [], total: 0 });
    await handleQuery({ collectionName: 'items', filters: { active: true }, limit: 10 });
    expect(mockQuery).toHaveBeenCalledWith({ filters: { active: true }, limit: 10 });
  });
});
