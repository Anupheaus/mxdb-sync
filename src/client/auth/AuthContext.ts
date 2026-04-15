import { createContext } from 'react';
import type { MXDBUserDetails } from '../../common/models';

export interface RegisterOptions {
  /** Override the WebAuthn relying-party name shown during credential creation. */
  appName?: string;
  /** Optional display name override (defaults to name from server invitation). */
  displayName?: string;
}

export interface AuthContextValue {
  isAuthenticated: boolean;
  user: MXDBUserDetails | undefined;
  signOut(): void;
  register(url: string, options?: RegisterOptions): Promise<{ userDetails: MXDBUserDetails }>;
}

export const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  user: undefined,
  signOut: () => { /* no-op outside provider */ },
  register: () => Promise.reject(new Error('AuthProvider not mounted')),
});
