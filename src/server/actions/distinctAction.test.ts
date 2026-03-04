import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDistinct } from './distinctAction';

const mockUseDb = vi.fn();
const mockUseClient = vi.fn();

vi.mock('../providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('../hooks', () => ({ useClient: () => mockUseClient() }));

describe('handleDistinct', () => {
  const collection = { name: 'items' };
  const mockDistinct = vi.fn();
  const mockDbCollection = { collection, distinct: mockDistinct };
  const mockPushRecords = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseClient.mockReturnValue({ pushRecords: mockPushRecords });
  });

  it('returns empty array when distinct returns null or empty', async () => {
    mockDistinct.mockResolvedValue(null);
    expect(await handleDistinct({ collectionName: 'items', field: 'name' })).toEqual([]);
    mockDistinct.mockResolvedValue([]);
    expect(await handleDistinct({ collectionName: 'items', field: 'name' })).toEqual([]);
  });

  it('calls pushRecords with collection and records and returns hash of ids', async () => {
    const records = [{ id: '1' }, { id: '2' }];
    mockDistinct.mockResolvedValue(records);
    const result = await handleDistinct({ collectionName: 'items', field: 'name' });
    expect(mockPushRecords).toHaveBeenCalledWith(collection, records);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
