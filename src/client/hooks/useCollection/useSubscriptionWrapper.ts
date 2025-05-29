import { is, type AnyObject, type Logger, type PromiseMaybe, type Record } from '@anupheaus/common';
import { useSync, type DbCollection } from '../../providers';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';
import type { UseSubscription } from './createUseSubscription';
import type { SocketAPIAction, SocketAPISubscription } from '@anupheaus/socket-api/common';
import { useLayoutEffect, useRef } from 'react';
import { DateTime } from 'luxon';
import type { AddDebugTo, AddDisableTo } from '../../../common/internalModels';

const RequestCancelled = Symbol('RequestCancelled');

interface Props<RecordType extends Record, Request extends AnyObject, Response extends AnyObject, RemoteRequest extends AnyObject, RemoteResponse> {
  collection: DbCollection<RecordType>;
  logger: Logger;
  subscription: SocketAPISubscription<string, RemoteRequest, RemoteResponse>;
  action: SocketAPIAction<string, RemoteRequest, RemoteResponse>;
  slowThreshold?: number;
  useSubscription: UseSubscription;
  onDefaultResponse(): Response;
  onRemoteDefaultResponse(): RemoteResponse;
  onRemoteResponse?(response: RemoteResponse): PromiseMaybe<void>;
  onOfflineAction?(): void;
  onExecute(request: Request): Promise<Response>;
  onRequestTransform?(request: Request): RemoteRequest;
}

export function useSubscriptionWrapper<RecordType extends Record, Request extends AnyObject, Response extends AnyObject, RemoteRequest extends AnyObject, RemoteResponse>({
  collection,
  logger,
  subscription,
  action,
  slowThreshold,
  useSubscription,
  onDefaultResponse,
  onOfflineAction,
  onRemoteDefaultResponse,
  onRemoteResponse,
  onRequestTransform,
  onExecute,
}: Props<RecordType, Request, Response, RemoteRequest, RemoteResponse>) {
  const { finishSyncing } = useSync();
  const { getIsConnected } = useSocketAPI();
  const { execute: remoteInvoke } = useSubscription(subscription);
  const actionResult = useAction(action);
  const lastRequestIdRef = useRef<string>();
  const lastResultHashRef = useRef<string>();
  const executeValidateAndUpdateRef = useRef(() => Promise.resolve());

  // listen to changes from the client collection and invoke again when it changes
  useLayoutEffect(() => collection.onChange(() => executeValidateAndUpdateRef.current()), []);

  async function invoke(props: AddDebugTo<AddDisableTo<Request>>, onResponse: (result: Response) => void): Promise<void>;
  async function invoke(props: AddDebugTo<AddDisableTo<Request>>): Promise<Response>;
  async function invoke(props: AddDebugTo<AddDisableTo<Request>>, onResponse?: (result: Response) => void): Promise<void | Response> {
    await finishSyncing();
    const { disable, debug, ...rest } = props;
    const request = rest as Request;
    const isActionRequired = !is.function(onResponse);

    const execute = async () => {
      if (debug) console.log('[MXDB-Sync] Executing query locally', { disable, request }); // eslint-disable-line no-console
      if (disable) {
        if (debug) console.log('[MXDB-Sync] Query is disabled, returning default', { disable, request }); // eslint-disable-line no-console
        return onDefaultResponse();
      }
      const requestId = lastRequestIdRef.current = Math.uniqueId();
      logger.debug(`[${requestId}] Querying records for collection "${collection.name}"...`, props);
      const startTime = DateTime.now();
      const response = await onExecute(request);
      if (lastRequestIdRef.current !== requestId) return RequestCancelled;
      const timeTaken = DateTime.now().diff(startTime).milliseconds;
      if (disable) return onDefaultResponse();
      if (slowThreshold != null && timeTaken > slowThreshold) {
        logger.warn(`[${requestId}] Query on collection "${collection.name}" took ${timeTaken}ms`, props);
      } else {
        logger.debug(`[${requestId}] Query on collection "${collection.name}" completed (time taken: ${timeTaken}ms).`);
      }
      if (debug) console.log('[MXDB-Sync] Finished executing query locally', { disable, request, response }); // eslint-disable-line no-console
      return response;
    };

    const okToExecute = () => {
      if (disable || onResponse == null) return false;
      if (!getIsConnected() && onOfflineAction != null) onOfflineAction(); // if we are offline
      return true;
    };

    // execute and validate and update the result only if it has changed
    const executeValidateAndUpdate = executeValidateAndUpdateRef.current = async () => {
      if (!okToExecute()) return;
      const result = await execute();
      if (result === RequestCancelled) return;
      validateAndUpdate(result);
    };

    // validate and update the result only if it has changed
    const validateAndUpdate = (response: Response) => {
      if (!okToExecute()) return;
      const resultHash = Object.hash(response);
      if (lastResultHashRef.current === resultHash) return;
      lastResultHashRef.current = resultHash;
      onResponse?.(response);
    };

    if (debug) console.log('[MXDB-Sync] Invoking remote query', { disable, isActionRequired, request }); // eslint-disable-line no-console
    const remoteQueryCalled = await remoteInvoke({
      request: (onRequestTransform?.(request) ?? request) as RemoteRequest,
      disable: disable || isActionRequired,
      debug,
      onEmptyUpdate: onRemoteDefaultResponse,
      onUpdate: async response => {
        if (debug) console.log('[MXDB-Sync] Received remote query response', { disable, isActionRequired, request, response }); // eslint-disable-line no-console
        await onRemoteResponse?.(response);
        await executeValidateAndUpdate();
      },
    });

    if (isActionRequired) {
      if (debug) console.log('[MXDB-Sync] Invoking action', { disable, isActionRequired, request }); // eslint-disable-line no-console
      const result = await actionResult[action.name]((onRequestTransform?.(request) ?? request) as RemoteRequest);
      if (debug) console.log('[MXDB-Sync] Received action response', { disable, isActionRequired, request, result }); // eslint-disable-line no-console
      await onRemoteResponse?.(result);
    }

    let result = await execute();
    if (debug) console.log('[MXDB-Sync] Finished calling local execute', { disable, isActionRequired, request, result, remoteQueryCalled }); // eslint-disable-line no-console
    if (result === RequestCancelled) result = onDefaultResponse();
    if (!remoteQueryCalled) {
      if (debug) console.log('[MXDB-Sync] Validating and updating result after local execution', { disable, isActionRequired, request, result }); // eslint-disable-line no-console
      validateAndUpdate(result);
    }

    return result;
  }

  return invoke;
}