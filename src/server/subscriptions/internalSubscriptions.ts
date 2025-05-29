import type { SocketAPIServerSubscription } from '@anupheaus/socket-api/server';
import { serverQuerySubscription } from './querySubscription';
import { serverDistinctSubscription } from './distinctSubscription';

export const internalSubscriptions: SocketAPIServerSubscription[] = [
  serverQuerySubscription,
  serverDistinctSubscription,
];
