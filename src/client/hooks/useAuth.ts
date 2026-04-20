import { useAuthentication } from '@anupheaus/socket-api/client';
import type { MXDBUserDetails } from '../../common/models';

export interface UseAuthResult {
  isAuthenticated: boolean;
  user: MXDBUserDetails | undefined;
  signOut(): Promise<void>;
}

export function useAuth(): UseAuthResult {
  const { user, signOut } = useAuthentication<MXDBUserDetails>();
  return {
    isAuthenticated: user != null,
    user,
    signOut,
  };
}
