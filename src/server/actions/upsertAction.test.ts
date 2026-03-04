import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUpsert } from './upsertAction';
import type { Record } from '@anupheaus/common';

const mockUseDb = vi.fn();
const mockGetCollectionExtensions = vi.fn();

vi.mock('../providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('../collections/extendCollection', () => ({ getCollectionExtensions: () => mockGetCollectionExtensions() }));

describe('handleUpsert', () => {
  const collection = { name: 'items' };
  const mockGet = vi.fn();
  const mockUpsert = vi.fn();
  const mockDbCollection = { collection, get: mockGet, upsert: mockUpsert };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
  });

  it('returns record ids', async () => {
    const records = [{ id: '1', name: 'a' }] as Record[];
    mockGet.mockResolvedValue([]);
    const result = await handleUpsert({ collectionName: 'items', records });
    expect(result).toEqual(['1']);
  });

  it('computes insertedIds and updatedIds and calls onBeforeUpsert with payload', async () => {
    const records = [{ id: '1', name: 'a' }, { id: '2', name: 'b' }] as Record[];
    mockGet.mockResolvedValue([{ id: '1', name: 'old' }]);
    const onBeforeUpsert = vi.fn();
    mockGetCollectionExtensions.mockReturnValue({ onBeforeUpsert });
    await handleUpsert({ collectionName: 'items', records });
    expect(onBeforeUpsert).toHaveBeenCalledWith({
      records,
      insertedIds: ['2'],
      updatedIds: ['1'],
    });
    expect(mockUpsert).toHaveBeenCalledWith(records);
  });

  it('calls upsert with records', async () => {
    const records = [{ id: '1', name: 'x' }] as Record[];
    mockGet.mockResolvedValue([]);
    mockGetCollectionExtensions.mockReturnValue(undefined);
    await handleUpsert({ collectionName: 'items', records });
    expect(mockUpsert).toHaveBeenCalledWith(records);
  });
});
