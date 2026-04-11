/**
 * Thin React wrapper over IndexedDbAuthStore.
 * Provides IndexedDbContext — pure CRUD, no business logic.
 */
import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { IndexedDbAuthStore } from './IndexedDbAuthStore';
import { IndexedDbContext } from './IndexedDbContext';
import type { MXDBAuthEntry } from './IndexedDbAuthStore';

interface Props {
  appName: string;
  children?: ReactNode;
}

export const IndexedDbProvider = createComponent('IndexedDbProvider', ({ appName, children }: Props) => {
  const value = useMemo(() => ({
    getDefault: () => IndexedDbAuthStore.getDefault(appName),
    saveEntry: (entry: MXDBAuthEntry) => IndexedDbAuthStore.save(appName, entry),
    clearDefault: () => IndexedDbAuthStore.clearAllDefaults(appName),
  }), [appName]);

  return (
    <IndexedDbContext.Provider value={value}>
      {children}
    </IndexedDbContext.Provider>
  );
});
