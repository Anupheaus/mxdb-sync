import { createServerActionHandler, useSocketAPI, type SocketAPIServerAction } from '@anupheaus/socket-api/server';
import { signInAction, testAction } from '../common';

export const actions: SocketAPIServerAction[] = [
  createServerActionHandler(testAction, async ({ foo }) => {
    return { bar: foo };
  }),
  createServerActionHandler(signInAction, async () => {
    const { setUser } = useSocketAPI();
    setUser({ id: Math.uniqueId() });
    return true;
  }),
];
