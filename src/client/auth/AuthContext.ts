import { createContext } from 'react';
import type { MXDBUserDetails } from '../../common/models';

export interface RegisterOptions {
  /** Optional display name override (defaults to name from server invitation). */
  displayName?: string;
}

export interface AuthContextValue {
  isAuthenticated: boolean;
  signOut(): void;
  register(url: string, options?: RegisterOptions): Promise<{ userDetails: MXDBUserDetails }>;
}

export const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  signOut: () => { /* no-op outside provider */ },
  register: () => Promise.reject(new Error('AuthProvider not mounted')),
});
