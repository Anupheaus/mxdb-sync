import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQuery } from './queryAction';

const mockUseDb = vi.fn();
const mockUseClient = vi.fn();

vi.mock('../providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('../hooks', () => ({ useClient: () => mockUseClient() }));

describe('handleQuery', () => {
  const collection = { name: 'items' };
  const mockQuery = vi.fn();
  const mockDbCollection = { collection, query: mockQuery };
  const mockPushRecords = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseClient.mockReturnValue({ pushRecords: mockPushRecords });
  });

  it('returns empty array when query returns no records', async () => {
    mockQuery.mockResolvedValue({ data: [], total: 0 });
    const result = await handleQuery({ collectionName: 'items' });
    expect(result).toEqual([]);
  });

  it('calls pushRecords and returns total when records returned', async () => {
    const records = [{ id: '1', name: 'a' }];
    mockQuery.mockResolvedValue({ data: records, total: 1 });
    const result = await handleQuery({ collectionName: 'items' });
    expect(mockPushRecords).toHaveBeenCalledWith(collection, records);
    expect(result).toBe(1);
  });
});
