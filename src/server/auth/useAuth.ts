import { useAuthentication } from '@anupheaus/socket-api/server';
import type { MXDBUserDetails } from '../../common/models';

export interface UseAuthResult {
  readonly user: MXDBUserDetails | undefined;
  setUser(user: MXDBUserDetails | undefined): Promise<void>;
  signOut(): Promise<void>;
  createInvite(userId: string, baseUrl: string): Promise<string>;
}

export function useAuth(): UseAuthResult {
  return useAuthentication<MXDBUserDetails>();
}
