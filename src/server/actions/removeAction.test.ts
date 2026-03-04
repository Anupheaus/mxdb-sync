import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRemove } from './removeAction';

const mockUseDb = vi.fn();
const mockUseClient = vi.fn();
const mockGetCollectionExtensions = vi.fn();
const mockUseLogger = vi.fn();

vi.mock('../providers', () => ({ useDb: () => mockUseDb() }));
vi.mock('../hooks', () => ({ useClient: () => mockUseClient() }));
vi.mock('../collections/extendCollection', () => ({ getCollectionExtensions: () => mockGetCollectionExtensions() }));
vi.mock('@anupheaus/common', async (importOriginal) => {
  const actual = await importOriginal() as object;
  return { ...actual, useLogger: () => mockUseLogger() };
});

describe('handleRemove', () => {
  const collection = { name: 'items' };
  const mockDelete = vi.fn();
  const mockDbCollection = { collection, delete: mockDelete };
  const mockRemoveFromClientIds = vi.fn();
  const mockLogger = { info: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDb.mockReturnValue({ use: () => mockDbCollection });
    mockUseClient.mockReturnValue({ removeFromClientIds: mockRemoveFromClientIds });
    mockUseLogger.mockReturnValue(mockLogger);
  });

  it('when locallyOnly is true, calls removeFromClientIds and does not delete', async () => {
    mockGetCollectionExtensions.mockReturnValue(undefined);
    await handleRemove({ collectionName: 'items', recordIds: ['a', 'b'], locallyOnly: true });
    expect(mockRemoveFromClientIds).toHaveBeenCalledWith(collection, ['a', 'b']);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('when locallyOnly is false, calls onBeforeDelete then delete', async () => {
    const onBeforeDelete = vi.fn();
    mockGetCollectionExtensions.mockReturnValue({ onBeforeDelete });
    await handleRemove({ collectionName: 'items', recordIds: ['a'], locallyOnly: false });
    expect(onBeforeDelete).toHaveBeenCalledWith({ recordIds: ['a'] });
    expect(mockDelete).toHaveBeenCalledWith(['a']);
  });

  it('when locallyOnly is false and no onBeforeDelete, still deletes', async () => {
    mockGetCollectionExtensions.mockReturnValue(undefined);
    await handleRemove({ collectionName: 'items', recordIds: ['x'], locallyOnly: false });
    expect(mockDelete).toHaveBeenCalledWith(['x']);
  });
});
