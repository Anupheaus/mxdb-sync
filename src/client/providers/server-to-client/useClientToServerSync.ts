import { createContext, useContext } from 'react';

/** Subset of ClientToServerSynchronisation exposed to S2C handlers. */
export interface ClientToServerSyncGate {
  /** §4.9.2 step 6 — wait for the C2S admission gate to resolve before applying S2C payloads. */
  waitForS2CGate(): Promise<void>;
}

const noopGate: ClientToServerSyncGate = {
  waitForS2CGate: () => Promise.resolve(),
};

export const ClientToServerSyncContext = createContext<ClientToServerSyncGate>(noopGate);

export function useClientToServerSync(): ClientToServerSyncGate {
  return useContext(ClientToServerSyncContext);
}
