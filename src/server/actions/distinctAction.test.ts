import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DistinctRequest } from '../../common/models';
import { handleDistinct } from './distinctAction';

/** Distinct tests use non-`id`-only field paths on synthetic rows. */
type TestRow = { id: string; name?: string; status?: string; active?: boolean };
const dr = (p: DistinctRequest<TestRow>) => p;

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

describe('handleDistinct', () => {
  const collection = { name: 'items' };
  const mockDistinct = vi.fn();
  const mockDbCollection = { collection, distinct: mockDistinct };
  const mockPushRecordsToClient = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSync.mockReturnValue({ pushRecordsToClient: mockPushRecordsToClient });
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: false });
  });

  it('returns empty array when distinct returns null or empty', async () => {
    mockDistinct.mockResolvedValue(null);
    expect(await handleDistinct(dr({ collectionName: 'items', field: 'name' }))).toEqual([]);
    mockDistinct.mockResolvedValue([]);
    expect(await handleDistinct(dr({ collectionName: 'items', field: 'name' }))).toEqual([]);
  });

  it('calls pushRecordsToClient and returns a hash string', async () => {
    const records = withIds([{ id: '1' }, { id: '2' }]);
    mockDistinct.mockResolvedValue(records);
    const result = await handleDistinct(dr({ collectionName: 'items', field: 'name' }));
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1', '2'], [], false);
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeGreaterThan(0);
  });

  it('passes disableAudit true for audit-free collections', async () => {
    mockConfigRegistryGetOrError.mockReturnValue({ disableAudit: true });
    const records = withIds([{ id: '1' }]);
    mockDistinct.mockResolvedValue(records);
    await handleDistinct(dr({ collectionName: 'items', field: 'name' }));
    expect(mockPushRecordsToClient).toHaveBeenCalledWith('items', ['1'], [], true);
  });

  it('does not call configRegistry when distinct returns empty', async () => {
    mockDistinct.mockResolvedValue([]);
    await handleDistinct(dr({ collectionName: 'items', field: 'name' }));
    expect(mockConfigRegistryGetOrError).not.toHaveBeenCalled();
  });
});
