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
const mockUseServerToClientSynchronisation = vi.fn();

vi.mock('../providers', () => ({
  useDb: () => mockUseDb(),
  useServerToClientSynchronisation: () => mockUseServerToClientSynchronisation(),
}));

describe('handleDistinct', () => {
  const collection = { name: 'items' };
  const mockDistinct = vi.fn();
  const mockDbCollection = { collection, distinct: mockDistinct };
  const mockSeedActive = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSynchronisation.mockReturnValue({ seedActive: mockSeedActive });
  });

  it('returns empty array when distinct returns null or empty', async () => {
    mockDistinct.mockResolvedValue(null);
    expect(await handleDistinct(dr({ collectionName: 'items', field: 'name' }))).toEqual([]);
    mockDistinct.mockResolvedValue([]);
    expect(await handleDistinct(dr({ collectionName: 'items', field: 'name' }))).toEqual([]);
  });

  it('calls seedActive and returns a hash string', async () => {
    const records = withIds([{ id: '1' }, { id: '2' }]);
    mockDistinct.mockResolvedValue(records);
    const result = await handleDistinct(dr({ collectionName: 'items', field: 'name' }));
    expect(mockSeedActive).toHaveBeenCalledWith('items', records);
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeGreaterThan(0);
  });

  it('does not call seedActive when distinct returns empty', async () => {
    mockDistinct.mockResolvedValue([]);
    await handleDistinct(dr({ collectionName: 'items', field: 'name' }));
    expect(mockSeedActive).not.toHaveBeenCalled();
  });
});
