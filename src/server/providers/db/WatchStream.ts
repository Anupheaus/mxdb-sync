import type { ChangeStreamDocument, ChangeStreamInsertDocument, ChangeStreamUpdateDocument, Db, Document } from 'mongodb';
import type { MongoDocOf, MXDBSyncedCollectionWatchUpdate } from '../../../common';
import { WatchStreamGroupedEvents } from './WatchStreamGroupedUpdates';
import type { Record } from '@anupheaus/common';
import { bind, is } from '@anupheaus/common';
import { useDb } from './useDb';

export class WatchStream {
  constructor(db: Db) {
    this.#db = db;
    this.#watchCallbacks = new Map();
    this.#watchIdLookups = new Map();
    this.#groupedEvents = new Map();
    this.#listenToChangeStream();
  }

  #db: Db;
  #watchCallbacks: Map<string, Map<string, { collectionName: string, callback: (update: MXDBSyncedCollectionWatchUpdate) => void; }>>;
  #watchIdLookups: Map<string, string>;
  #groupedEvents: Map<string, WatchStreamGroupedEvents>;

  public get count() { return this.#watchIdLookups.size; }

  @bind
  public addWatch(watchId: string, collectionName: string, callback: (update: MXDBSyncedCollectionWatchUpdate) => void) {
    const config = { collectionName, callback };
    const configs = this.#watchCallbacks.getOrSet(collectionName, () => new Map());
    configs.set(watchId, config);
    this.#watchIdLookups.set(watchId, collectionName);
  }

  @bind
  public removeWatch(watchId: string) {
    const collectionName = this.#watchIdLookups.get(watchId);
    if (!collectionName) return;
    const configs = this.#watchCallbacks.get(collectionName);
    if (!configs) return;
    configs.delete(watchId);
    this.#watchIdLookups.delete(watchId);
  }

  #handleUpdateEvents(events: (ChangeStreamInsertDocument<Document> | ChangeStreamUpdateDocument<Document>)[]) {
    const { fromMongoDoc } = useDb();
    const collectionName = events[0].ns.coll;
    const configs = this.#watchCallbacks.get(collectionName);
    if (!configs) return;
    const allConfigs = Array.from(configs.values());
    if (allConfigs.length === 0) return;
    const update: MXDBSyncedCollectionWatchUpdate = {
      type: 'upsert',
      records: events.mapWithoutNull(event => event.fullDocument ? fromMongoDoc(event.fullDocument as MongoDocOf<Record>) : undefined),
    };
    allConfigs.forEach(({ callback }) => callback(update));
  }

  #handleFlush() {
    return (events: Document[]) => {
      if (events.length === 0) return;
      const eventType = events[0].operationType;
      switch (eventType) {
        case 'insert':
        case 'update': {
          this.#handleUpdateEvents(events as (ChangeStreamInsertDocument<Document> | ChangeStreamUpdateDocument<Document>)[]);
          break;
        }
        case 'replace':
        case 'delete':
      }
    };
  }

  #handleDestroy(eventId: string) {
    return () => {
      this.#groupedEvents.delete(eventId);
    };
  }

  #handleEvent(change: ChangeStreamDocument) {
    const eventId = (change._id as any).toString() as string;
    const collectionName = 'ns' in change && change.ns != null && 'coll' in change.ns ? change.ns.coll : undefined;
    if (!is.string(collectionName) || !is.string(eventId)) return;
    const groupedEvents = this.#groupedEvents.getOrSet(eventId, () => new WatchStreamGroupedEvents({
      collectionName,
      eventId,
      onFlush: this.#handleFlush(),
      onDestroy: this.#handleDestroy(eventId),
    }));
    groupedEvents.add(change);
  }

  #listenToChangeStream() {
    const changeStream = this.#db.watch([{ $project: { documentKey: false } }]);
    changeStream.on('change', change => this.#handleEvent(change));
  }

}