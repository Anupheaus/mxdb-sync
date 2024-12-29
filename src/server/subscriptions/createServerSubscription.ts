import type { PromiseMaybe } from '@anupheaus/common';
import type { MXDBSubscription } from '../../common';

export interface MXDBServerSubscriptionConfig<Request, Response> {
  trigger(trigger: () => void): void;
  onRequest(request: Request): PromiseMaybe<Response>;
}

export function createServerSubscription<Name extends string, Request, Response>(subscription: MXDBSubscription<Name, Request, Response>, config: MXDBServerSubscriptionConfig<TRequest, TResponse>): ServerSubscription<TRequest, TResponse> {
  return {
    subscription,
    handler,
  };
}