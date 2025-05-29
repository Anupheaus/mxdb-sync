import type { SocketAPISubscription } from '@anupheaus/socket-api/common';
import { useSocketAPI, useSubscription } from '@anupheaus/socket-api/client';
import { useBound, useOnUnmount } from '@anupheaus/react-ui';

export type UseSubscription = ReturnType<typeof createUseSubscription>;

export interface UseSubscriptionExecuteProps<Request, Response> {
  disable?: boolean;
  debug?: boolean;
  request: Request;
  onUpdate(response: Response, debug?: boolean): void;
  onEmptyUpdate(): Response;
}

export function createUseSubscription() {
  return <Name extends string, Request, Response>(subscription: SocketAPISubscription<Name, Request, Response>) => {
    const { subscribe: socketAPISubscribe, unsubscribe, onCallback } = useSubscription(subscription as SocketAPISubscription<Name, Request, Response>);

    useOnUnmount(unsubscribe);

    const subscribe = socketAPISubscribe;

    const { getIsConnected } = useSocketAPI();

    const execute = useBound(async ({ disable, debug, onUpdate, onEmptyUpdate, request }: UseSubscriptionExecuteProps<Request, Response>): Promise<boolean> => {
      if (debug) console.log('[MXDB-Sync] Registering callback', { disable, request, onUpdate }); // eslint-disable-line no-console
      onCallback(onUpdate);
      if (disable) {
        if (debug) console.log('[MXDB-Sync] Disabled, so unsubscribing', { disable, request }); // eslint-disable-line no-console
        unsubscribe(debug);
        if (debug) console.log('[MXDB-Sync] Calling onUpdate with empty response', { disable, request }); // eslint-disable-line no-console
        onUpdate(onEmptyUpdate(), debug);
      } else {

        if (getIsConnected()) {
          if (debug) console.log('[MXDB-Sync] Subscribing to server', { disable, request }); // eslint-disable-line no-console
          await subscribe(request, undefined, debug);
          return true;
        } else {
          if (debug) console.log('[MXDB-Sync] Offline, so calling onUpdate with empty response', { disable, request }); // eslint-disable-line no-console
          onUpdate(onEmptyUpdate(), debug);
        }
      }
      return false;
    });

    return {
      execute,
      unsubscribe,
      subscribe,
      onCallback,
    };
  };

}