// src/client/hooks/useMXDBSignOut.ts
import { useContext, useCallback } from 'react';
import { AuthContext } from '../auth/AuthContext';

export interface UseMXDBSignOutResult {
  signOut(): void;
}

export function useMXDBSignOut(): UseMXDBSignOutResult {
  const { signOut } = useContext(AuthContext);
  return { signOut: useCallback(() => signOut(), [signOut]) };
}
