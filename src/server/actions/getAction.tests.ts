import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGet } from './getAction';

function withIds<T extends { id: string }>(items: T[]): T[] & { ids: () => string[] } {
  return Object.assign(items, { ids: () => items.map(r => r.id) });
}

const mockUseDb = vi.fn();
const mockUseServerToClientSynchronisation = vi.fn();

vi.mock('../providers', () => ({
  useDb: () => mockUseDb(),
  useServerToClientSynchronisation: () => mockUseServerToClientSynchronisation(),
}));

describe('handleGet', () => {
  const collection = { name: 'items' };
  const mockGet = vi.fn();
  const mockDbCollection = { collection, get: mockGet };
  const mockSeedActive = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSynchronisation.mockReturnValue({ seedActive: mockSeedActive });
  });

  it('returns empty array when get returns null or empty', async () => {
    mockGet.mockResolvedValue(null);
    expect(await handleGet({ collectionName: 'items', ids: ['1'] })).toEqual([]);
    mockGet.mockResolvedValue([]);
    expect(await handleGet({ collectionName: 'items', ids: ['1'] })).toEqual([]);
  });

  it('calls seedActive and returns ids', async () => {
    const records = withIds([{ id: '1', name: 'a' }, { id: '2', name: 'b' }]);
    mockGet.mockResolvedValue(records);
    const result = await handleGet({ collectionName: 'items', ids: ['1', '2'] });
    expect(mockSeedActive).toHaveBeenCalledWith('items', records);
    expect(result).toEqual(['1', '2']);
  });

  it('does not call seedActive when no records returned', async () => {
    mockGet.mockResolvedValue([]);
    await handleGet({ collectionName: 'items', ids: [] });
    expect(mockSeedActive).not.toHaveBeenCalled();
  });
});
