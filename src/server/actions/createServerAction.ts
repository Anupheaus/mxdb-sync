import { is, type PromiseMaybe } from '@anupheaus/common';
import type { MXDBAction } from '../../common';
import { useClient } from '../providers/socket/useClient';

export interface MXDBServerAction {
  (): void;
}

type MXDBServerActionHandler<Request, Response> = (request: Request) => PromiseMaybe<Response>;

const registeredActions = new Set<string>();

export function createServerAction<Name extends string, Request, Response>(action: MXDBAction<Name, Request, Response>, handler: MXDBServerActionHandler<Request, Response>): MXDBServerAction {
  return () => {
    const { client, logger } = useClient();
    logger.info('Registering action', { action: action.name });
    client.on(action.name.toString(), async (...args: unknown[]) => {
      if (registeredActions.has(action.name)) throw new Error(`Listener for action '${action.name}' already registered.`);
      const requestId = Math.uniqueId();
      const response = args.pop();
      logger.info('Action Invoked', { action: action.name, args, requestId });
      const result = await (handler as Function)(...args);
      logger.info('Action Result', { action: action.name, result, requestId });
      if (is.function(response)) response(result);
    });
  };
}
