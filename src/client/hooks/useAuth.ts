// src/client/hooks/useAuth.ts
import { useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';
import type { MXDBUserDetails } from '../../common/models';

export interface UseAuthResult {
  isAuthenticated: boolean;
  user: MXDBUserDetails | undefined;
  signOut(): void;
}

export function useAuth(): UseAuthResult {
  const { isAuthenticated, user, signOut } = useContext(AuthContext);
  return { isAuthenticated, user, signOut };
}
