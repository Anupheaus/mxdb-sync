import { is, type PromiseMaybe } from '@anupheaus/common';
import type { MXDBAction } from '../../common';
import { useClient } from '../providers/socket/useClient';
import { useCollections } from '../collections';
import { provideLogger, useLogger } from '../providers';

export interface MXDBServerAction {
  (): void;
}

type MXDBServerActionHandler<Request, Response> = (request: Request) => PromiseMaybe<Response>;

const registeredActions = new Set<string>();

export function createServerAction<Name extends string, Request, Response>(action: MXDBAction<Name, Request, Response>, handler: MXDBServerActionHandler<Request, Response>): MXDBServerAction {
  if (registeredActions.has(action.name)) throw new Error(`Listener for action '${action.name}' already registered.`);
  registeredActions.add(action.name);
  return () => {
    const logger = useLogger();
    const { client, provideClient } = useClient();
    const { provideCollections } = useCollections();
    logger.silly('Registering action', { action: action.name });

    client.on(`mxdb.actions.${action.name.toString()}`, provideLogger(logger, provideCollections(provideClient(async (...args: unknown[]) => {
      const requestId = Math.uniqueId();
      const response = args.pop();
      logger.info('Action Invoked', { action: action.name, args, requestId });
      const result = await (handler as Function)(...args);
      logger.info('Action Result', { action: action.name, result, requestId });
      if (is.function(response)) response(result);
    }))));
  };
}
