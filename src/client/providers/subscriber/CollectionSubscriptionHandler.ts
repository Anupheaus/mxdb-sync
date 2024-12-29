// import type { AnyObject } from '@anupheaus/common';
// import { PromiseState, type DeferredPromise } from '@anupheaus/common';
// import type { MXDBSyncedCollection } from '../../../common';
// import type { useSocket } from '../socket';
// import { SyncEvents } from '../../../common/syncEvents';
// import type { SocketEmit } from '../../../server/providers';

// type SocketUtils = ReturnType<typeof useSocket>;

// interface RegisterOrUpdateProps {
//   hookId: string;
//   onUpdate(response: unknown): void;
// }

// interface CollectionSubscriptionHandlerProps {
//   collection: MXDBSyncedCollection;
//   dbName: string | undefined;
//   props: AnyObject;
//   type: string;
//   onUpdate(response: unknown): void;
//   emit: SocketUtils['emit'];
//   on: SocketUtils['on'];
// }

// export class CollectionSubscriptionHandler {
//   constructor({ collection, props, type, on, emit }: CollectionSubscriptionHandlerProps) {
//     this.#hookCallbacks = new Map();
//     this.#collection = collection;
//     this.#props = props;
//     this.#type = type;
//     this.#emit = emit;
//     this.#subscriberId = Math.uniqueId();
//     this.#isListening = false;
//     this.#lastResponse = Promise.createDeferred();
//     on(...SyncEvents.collection(collection).subscriptionUpdate(this.#subscriberId).createSocketHandler(async response => {
//       this.#lastResponse.resolve(response);
//       for (const { onUpdate } of this.#hookCallbacks.values()) {
//         onUpdate(response);
//       }
//     }));
//   }

//   #hookCallbacks: Map<string, RegisterOrUpdateProps>;
//   #collection: MXDBSyncedCollection;
//   #props: AnyObject;
//   #type: string;
//   #emit: SocketEmit;
//   #subscriberId: string;
//   #isListening: boolean;
//   #lastResponse: DeferredPromise<unknown>;

//   public get length() { return this.#hookCallbacks.size; }

//   public async registerOrUpdateHook(props: RegisterOrUpdateProps): Promise<void> {
//     this.#hookCallbacks.set(props.hookId, props);
//     this.#startListening();
//     const fireOnUpdate = this.#lastResponse.state === PromiseState.Fulfilled;
//     const response = await this.#lastResponse;
//     if (fireOnUpdate) props.onUpdate(response);
//   }

//   public unregisterHook(hookId: string) {
//     this.#hookCallbacks.delete(hookId);
//     this.#stopListening();
//   }

//   async #startListening() {
//     if (this.#isListening) return;
//     this.#isListening = true;
//     await SyncEvents.collection(this.#collection).subscriptionRegister.emit(this.#emit, { type: this.#type, subscriberId: this.#subscriberId, props: this.#props });
//   }

//   async #stopListening() {
//     if (!this.#isListening || this.#hookCallbacks.size > 0) return;
//     this.#isListening = false;
//     await SyncEvents.collection(this.#collection).subscriptionUnregister.emit(this.#emit, this.#subscriberId);
//   }
// }