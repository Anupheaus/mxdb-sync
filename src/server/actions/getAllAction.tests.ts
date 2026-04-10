import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAll } from './getAllAction';

function withIds<T extends { id: string }>(items: T[]): T[] & { ids: () => string[] } {
  return Object.assign(items, { ids: () => items.map(r => r.id) });
}

const mockUseDb = vi.fn();
const mockUseServerToClientSynchronisation = vi.fn();

vi.mock('../providers', () => ({
  useDb: () => mockUseDb(),
  useServerToClientSynchronisation: () => mockUseServerToClientSynchronisation(),
}));

describe('handleGetAll', () => {
  const collection = { name: 'items' };
  const mockGetAll = vi.fn();
  const mockDbCollection = { collection, getAll: mockGetAll };
  const mockPushActive = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseServerToClientSynchronisation.mockReturnValue({ pushActive: mockPushActive });
  });

  it('returns empty array when collection has no records', async () => {
    mockGetAll.mockResolvedValue([]);
    const result = await handleGetAll({ collectionName: 'items' });
    expect(result).toEqual([]);
    expect(mockPushActive).not.toHaveBeenCalled();
  });

  it('calls pushActive and returns record ids', async () => {
    const records = withIds([{ id: '1', name: 'a' }]);
    mockGetAll.mockResolvedValue(records);
    const result = await handleGetAll({ collectionName: 'items' });
    expect(mockPushActive).toHaveBeenCalledWith('items', records);
    expect(result).toEqual(['1']);
  });

  it('does not call pushActive when no records returned', async () => {
    mockGetAll.mockResolvedValue([]);
    await handleGetAll({ collectionName: 'items' });
    expect(mockPushActive).not.toHaveBeenCalled();
  });
});
