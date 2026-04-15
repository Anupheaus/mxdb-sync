import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { mxdbSignOutAction } from '../../common/internalActions';
import { useAuth } from '../auth/useAuth';

export const serverSignOutAction = createServerActionHandler(mxdbSignOutAction, async () => {
  useAuth().signOut();
});
