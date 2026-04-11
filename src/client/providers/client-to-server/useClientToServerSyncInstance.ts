import { createContext, useContext } from 'react';
import type { ClientToServerSynchronisation } from './ClientToServerSynchronisation';

export const ClientToServerSyncInstanceContext = createContext<ClientToServerSynchronisation | null>(null);

/** Access the ClientToServerSynchronisation instance (constructed in IndexedDbProvider). */
export function useClientToServerSyncInstance(): ClientToServerSynchronisation | null {
  return useContext(ClientToServerSyncInstanceContext);
}
