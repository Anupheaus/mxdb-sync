import type { SocketAPISubscription } from '@anupheaus/socket-api/common';
import { createServerSubscription } from '@anupheaus/socket-api/server';
import type { SocketAPIServerSubscriptionHandler } from '../../../../socket-api/src/server/subscriptions/createServerSubscription';
import { InternalError, type PromiseMaybe } from '@anupheaus/common';
import { useClient } from '../hooks';

type SocketAPIServerSubscriptionHandlerParameters<Request, Response> = Parameters<SocketAPIServerSubscriptionHandler<Request, Response>>[0];

interface MXDBSyncServerSubscriptionHandlerParameters<Request, Response, AdditionalData = unknown> extends SocketAPIServerSubscriptionHandlerParameters<Request, Response> {
  previousResponse: Response | undefined;
  additionalData: AdditionalData | undefined;
  updateAdditionalData(data: AdditionalData): void;
}


type MXDBSyncServerSubscriptionHandler<Request, Response, AdditionalData = unknown> =
  (parameters: MXDBSyncServerSubscriptionHandlerParameters<Request, Response, AdditionalData>) => PromiseMaybe<Response>;

export function createServerCollectionSubscription<AdditionalData = unknown>() {
  return <Name extends string, Request, Response>(subscription: SocketAPISubscription<Name, Request, Response>,
    handler: MXDBSyncServerSubscriptionHandler<Request, Response, AdditionalData>) => {
    return createServerSubscription(subscription as SocketAPISubscription<Name, Request, Response>,
      async ({ request, subscriptionId, update, onUnsubscribe }) => {
        const { isDataAvailable, getData, setData } = useClient();
        const saveAsPreviousResponse = (response: Response) => setData(`subscription-data.${subscriptionId}`, response);
        const updateAdditionalData = (data: AdditionalData) => setData(`subscription-data.additional.${subscriptionId}`, data);
        const additionalData = getData<AdditionalData>(`subscription-data.additional.${subscriptionId}`);
        if (!isDataAvailable()) throw new InternalError('Unable to retrieve the data for a subscription request this client, is not available at this location.');
        const previousResponse = getData<Response | undefined>(`subscription-data.${subscriptionId}`);
        const wrappedUpdate = (response: Response) => {
          saveAsPreviousResponse(response);
          update(response);
        };
        const result = await handler({
          previousResponse, request, subscriptionId,
          additionalData, updateAdditionalData, update: wrappedUpdate, onUnsubscribe,
        });
        saveAsPreviousResponse(result);
        return result;
      });
  };
}
