import { createContext } from 'react';
import type { MXDBUserDetails } from '../../common/models';

export interface UserIdContextValue {
  user: MXDBUserDetails | undefined;
  setUser(user: MXDBUserDetails): void;
}

export const UserIdContext = createContext<UserIdContextValue>({
  user: undefined,
  setUser: () => { /* no-op outside provider */ },
});
