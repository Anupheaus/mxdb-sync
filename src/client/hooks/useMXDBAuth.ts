// src/client/hooks/useMXDBAuth.ts
import { useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';

export interface UseMXDBAuthResult {
  isAuthenticated: boolean;
}

export function useMXDBAuth(): UseMXDBAuthResult {
  const { isAuthenticated } = useContext(AuthContext);
  return { isAuthenticated };
}
