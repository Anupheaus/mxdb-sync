import { createContext, useContext } from 'react';

/** Subset of ClientToServerSynchronisation exposed to S2C handlers. */
export interface ClientToServerSyncGate {
  /** §4.9.2 step 6 — wait for the C2S admission gate to resolve before applying S2C payloads. */
  waitForS2CGate(): Promise<void>;
  /** Whether the record is enqueued for C2S (`ClientToServerSynchronisation.hasQueuedPendingForRecord`). */
  hasQueuedPendingForRecord(collectionName: string, recordId: string): boolean;
}

const noopGate: ClientToServerSyncGate = {
  waitForS2CGate: () => Promise.resolve(),
  /** No C2S instance — do not treat as “missing queue” (avoids false errors outside MXDBSync). */
  hasQueuedPendingForRecord: () => true,
};

export const ClientToServerSyncContext = createContext<ClientToServerSyncGate>(noopGate);

export function useClientToServerSync(): ClientToServerSyncGate {
  return useContext(ClientToServerSyncContext);
}
