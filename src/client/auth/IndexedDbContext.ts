import { createContext } from 'react';
import type { MXDBAuthEntry } from './IndexedDbAuthStore';

export interface IndexedDbContextValue {
  getDefault(): Promise<MXDBAuthEntry | undefined>;
  saveEntry(entry: MXDBAuthEntry): Promise<void>;
  clearDefault(): Promise<void>;
}

const noOp = (): Promise<void> => Promise.resolve();

export const IndexedDbContext = createContext<IndexedDbContextValue>({
  getDefault: () => Promise.resolve(undefined),
  saveEntry: noOp,
  clearDefault: noOp,
});
