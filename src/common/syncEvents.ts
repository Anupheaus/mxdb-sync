import type { Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from './models';
import type { MXDBSyncRequest, MXDBSyncResponse, SubscriptionRequest, SubscriptionResponse } from './internalModels';

type Emit = ((eventName: string, data: any) => void | Promise<any>) | (<Ev extends string>(ev: Ev, ...args: any[]) => boolean);

const defineCollectionEvent = <Request, Response = void>(eventName: string) => ({
  createSocketHandler: <H extends (data: Request) => Promise<Response>>(handler: H): [string, H] => [eventName, handler],
  emit: (emit: Emit, data: Request): Promise<Response> => emit(eventName, data) as any,
});

export const SyncEvents = {
  collection: <RecordType extends Record>(syncCollection: MXDBSyncedCollection<RecordType>) => ({
    get: defineCollectionEvent<string, RecordType | undefined>(`mxdb-sync.${syncCollection.name}.get`),
    sync: defineCollectionEvent<MXDBSyncRequest, MXDBSyncResponse<RecordType>>(`mxdb-sync.${syncCollection.name}.sync`),
    // queryUpdateRegister: defineCollectionEvent<QueryRequest<RecordType>>(`mxdb-sync.${syncCollection.name}.queryUpdate.register`),
    // queryUpdate: (handlerId: string) => defineCollectionEvent<QueryResponse<RecordType>>(`mxdb-sync.${syncCollection.name}.queryUpdate.${handlerId}`),
    // queryUpdateUnregister: defineCollectionEvent<string>(`mxdb-sync.${syncCollection.name}.queryUpdate.unregister`),
    // distinctUpdateRegister: defineCollectionEvent<DistinctRequest<RecordType>>(`mxdb-sync.${syncCollection.name}.distinctUpdate.register`),
    // distinctUpdate: (handlerId: string) => defineCollectionEvent<RecordType[]>(`mxdb-sync.${syncCollection.name}.distinctUpdate.${handlerId}`),
    // distinctUpdateUnregister: defineCollectionEvent<string>(`mxdb-sync.${syncCollection.name}.distinctUpdate.unregister`),
    subscriptionRegister: defineCollectionEvent<SubscriptionRequest>(`mxdb-sync.${syncCollection.name}.subscription.register`),
    subscriptionUpdate: (subscriberId: string) => defineCollectionEvent<SubscriptionResponse<RecordType>>(`mxdb-sync.${syncCollection.name}.subscriptionUpdate.${subscriberId}`),
    subscriptionUnregister: defineCollectionEvent<string>(`mxdb-sync.${syncCollection.name}.subscription.unregister`),
  }),
};
