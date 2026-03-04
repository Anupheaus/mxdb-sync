import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGet } from './getAction';

const mockUseDb = vi.fn();
const mockUseClient = vi.fn();

vi.mock('../providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('../hooks', () => ({ useClient: () => mockUseClient() }));

describe('handleGet', () => {
  const collection = { name: 'items' };
  const mockGet = vi.fn();
  const mockDbCollection = { collection, get: mockGet };
  const mockPushRecords = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseClient.mockReturnValue({ pushRecords: mockPushRecords });
  });

  it('returns empty array when get returns null or empty', async () => {
    mockGet.mockResolvedValue(null);
    expect(await handleGet({ collectionName: 'items', ids: ['1'] })).toEqual([]);
    mockGet.mockResolvedValue([]);
    expect(await handleGet({ collectionName: 'items', ids: ['1'] })).toEqual([]);
  });

  it('calls pushRecords with collection and records and returns ids', async () => {
    const records = [{ id: '1', name: 'a' }, { id: '2', name: 'b' }];
    mockGet.mockResolvedValue(records);
    const result = await handleGet({ collectionName: 'items', ids: ['1', '2'] });
    expect(mockPushRecords).toHaveBeenCalledWith(collection, records);
    expect(result).toEqual(['1', '2']);
  });
});
