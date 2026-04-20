import { useSocketAPI } from '@anupheaus/socket-api/server';
import type { MXDBUserDetails } from '../../common/models';

export interface UseAuthResult {
  readonly user: MXDBUserDetails | undefined;
  setUser(user: MXDBUserDetails | undefined): Promise<void>;
  signOut(): Promise<void>;
  createInvite(userId: string, baseUrl: string): Promise<string>;
}

export function useAuth(): UseAuthResult {
  const api = useSocketAPI<MXDBUserDetails>();
  return {
    get user() { return api.user; },
    setUser: api.setUser,
    signOut: api.signOut,
    createInvite: api.createInvite,
  };
}
