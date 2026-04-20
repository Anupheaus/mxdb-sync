import { useAuthentication } from '@anupheaus/socket-api/client';

export function useMXDBSignOut(): () => Promise<void> {
  return useAuthentication().signOut;
}
