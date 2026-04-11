// src/client/hooks/useMXDBInvite.ts
import { useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';
import type { RegisterOptions } from '../auth/AuthContext';
import type { MXDBUserDetails } from '../../common/models';

export type { RegisterOptions };

export function useMXDBInvite(): (url: string, options?: RegisterOptions) => Promise<{ userDetails: MXDBUserDetails }> {
  const { register } = useContext(AuthContext);
  return register;
}
