import { useAuthentication } from '@anupheaus/socket-api/client';

export function useMXDBUserId(): string | undefined {
  return useAuthentication().user?.id;
}
