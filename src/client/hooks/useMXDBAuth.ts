import { useContext } from 'react';
import { AuthTokenContext } from '../auth/AuthTokenContext';

export interface UseMXDBAuthResult {
  /** True once a device entry is loaded from IndexedDB and the SQLite DB is open. */
  isAuthenticated: boolean;
}

export function useMXDBAuth(): UseMXDBAuthResult {
  const { isAuthenticated } = useContext(AuthTokenContext);
  return { isAuthenticated };
}
