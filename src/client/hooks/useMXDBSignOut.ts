import { useAuthentication } from '@anupheaus/socket-api/client';

export function useMXDBSignOut(): { signOut(): Promise<void> } {
  const { signOut } = useAuthentication();
  return { signOut };
}
