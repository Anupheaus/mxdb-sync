// src/client/hooks/useMXDBUserId.ts
import { useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';

/**
 * Returns the userId of the currently authenticated user, as provided by the
 * server after device token validation via the mxdbUserAuthenticated event.
 */
export function useMXDBUserId(): string | undefined {
  return useContext(AuthContext).user?.id;
}
