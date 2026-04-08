import { createContext, useContext } from 'react';
import type { ClientReceiver } from '../../../common/sync-engine';

export const ClientReceiverContext = createContext<ClientReceiver | null>(null);

export function useClientReceiver(): ClientReceiver | null {
  return useContext(ClientReceiverContext);
}
