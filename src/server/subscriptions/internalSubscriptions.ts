import type { SocketAPIServerSubscription } from '@anupheaus/socket-api/server';
import { serverQuerySubscription } from './querySubscription';
import { serverDistinctSubscription } from './distinctSubscription';
import { serverGetAllSubscription } from './getAllSubscription';

export const internalSubscriptions: SocketAPIServerSubscription[] = [
  serverQuerySubscription,
  serverDistinctSubscription,
  serverGetAllSubscription,
];
