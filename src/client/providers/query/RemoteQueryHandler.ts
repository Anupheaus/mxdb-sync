import { PromiseState, type DeferredPromise, type Record } from '@anupheaus/common';
import type { MXDBSyncedCollection } from '../../../common';
import type { useSocket } from '../socket';
import { SyncEvents } from '../../../common/syncEvents';
import type { QueryProps } from '@anupheaus/mxdb';
import type { RemoteQueryUpdate } from './useRemoteQuery';
import type { SocketEmit } from '../../../server/providers';

type SocketUtils = ReturnType<typeof useSocket>;

interface RegisterOrUpdateProps {
  hookId: string;
  onUpdate(result: RemoteQueryUpdate): void;
}

interface Props<RecordType extends Record> {
  collection: MXDBSyncedCollection<RecordType>;
  dbName: string | undefined;
  props: QueryProps<RecordType>;
  dataUpsert(records: RecordType[]): Promise<void>;
  upsertFromQuery(records: RecordType[]): Promise<RecordType[]>;
  emit: SocketUtils['emit'];
  on: SocketUtils['on'];
}

export class QueryUpdateHandler<RecordType extends Record = any> {
  constructor({ collection, props, on, dataUpsert, upsertFromQuery, emit }: Props<RecordType>) {
    this.#hookCallbacks = new Map();
    this.#collection = collection;
    this.#props = props;
    this.#emit = emit;
    this.#handlerId = Math.uniqueId();
    this.#isListening = false;
    this.#lastTotalPromise = Promise.createDeferred();
    on(...SyncEvents.collection(collection).queryUpdate(this.#handlerId).createSocketHandler(async response => {
      this.#lastTotalPromise.resolve(response.total);
      for (const { onUpdate } of this.#hookCallbacks.values()) {
        onUpdate({ total: response.total });
      }
      const updatableRecords = await upsertFromQuery(response.records);
      if (updatableRecords.length === 0) return;
      await dataUpsert(updatableRecords);
    }));
  }

  #hookCallbacks: Map<string, RegisterOrUpdateProps>;
  #collection: MXDBSyncedCollection<RecordType>;
  #props: QueryProps<RecordType>;
  #emit: SocketEmit;
  #handlerId: string;
  #isListening: boolean;
  #lastTotalPromise: DeferredPromise<number>;

  public get length() { return this.#hookCallbacks.size; }

  public async registerOrUpdateHook(props: RegisterOrUpdateProps): Promise<void> {
    this.#hookCallbacks.set(props.hookId, props);
    this.#startListening();
    const fireOnUpdate = this.#lastTotalPromise.state === PromiseState.Fulfilled;
    const total = await this.#lastTotalPromise;
    if (fireOnUpdate) props.onUpdate({ total });
  }

  public unregisterHook(hookId: string) {
    this.#hookCallbacks.delete(hookId);
    this.#stopListening();
  }

  async #startListening() {
    if (this.#isListening) return;
    this.#isListening = true;
    await SyncEvents.collection(this.#collection).queryUpdateRegister.emit(this.#emit, { ...this.#props, handlerId: this.#handlerId });
  }

  async #stopListening() {
    if (!this.#isListening || this.#hookCallbacks.size > 0) return;
    this.#isListening = false;
    await SyncEvents.collection(this.#collection).queryUpdateUnregister.emit(this.#emit, this.#handlerId);
  }
}