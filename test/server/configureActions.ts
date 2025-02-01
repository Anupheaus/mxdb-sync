import { createServerAction, useSocketAPI, type SocketAPIServerAction } from '@anupheaus/socket-api/server';
import { signInAction, testAction } from '../common';

export const actions: SocketAPIServerAction[] = [
  createServerAction(testAction, async ({ foo }) => {
    return { bar: foo };
  }),
  createServerAction(signInAction, async () => {
    const { setUser } = useSocketAPI();
    setUser({ id: Math.uniqueId() });
    return true;
  }),
];
