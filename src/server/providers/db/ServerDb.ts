import type { MongoDocOf, MXDBCollection } from '../../../common';
import type { ChangeStream, ChangeStreamDocument, Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import { getCollectionExtensions } from '../../collections/extendCollection';
import { ServerDbCollection } from './ServerDbCollection';
import { ServerDbCollectionEvents } from './ServerDbCollectionEvents';
import type { ServerDbChangeEvent } from './server-db-models';
import { is, type Logger, type Record, type Unsubscribe } from '@anupheaus/common';
import { AsyncLocalStorage } from 'async_hooks';

interface Props {
  mongoDbName: string;
  mongoDbUrl: string;
  collections: MXDBCollection[];
  logger: Logger;
  /** Idle window (ms) for change stream batching; passed to ServerDbCollectionEvents. Default 20. */
  changeStreamDebounceMs?: number;
}

export class ServerDb {
  constructor(props: Props) {
    this.#mongoDbName = props.mongoDbName;
    this.#changeStreamDebounceMs = props.changeStreamDebounceMs;
    this.#client = new MongoClient(props.mongoDbUrl);
    this.#logger = props.logger.createSubLogger('ServerDb');
    this.#dbEvents = new Map();
    this.#setupEvents();
    this.#db = this.#connect();
    this.#collections = this.#setupCollections(props.collections);
    this.#changeCallbacks = new Set();
  }

  #mongoDbName: string;
  #client: MongoClient;
  #collections: Map<string, ServerDbCollection<any>>;
  #logger: Logger;
  #db: Promise<Db>;
  #changeStream: ChangeStream | undefined;
  #dbEvents: Map<string, ServerDbCollectionEvents>;
  #changeCallbacks: Set<(event: ServerDbChangeEvent) => void>;
  #changeStreamDebounceMs: number | undefined;
  /** Fibonacci backoff for connect retries (ms); capped at 60s. Reset after a successful connect. */
  #connectBackoffMsPrev = 500;
  #connectBackoffMsCurr = 500;
  #connectAttempt = 0;

  public use<RecordType extends Record>(collectionName: string) {
    return this.#collections.get(collectionName) as ServerDbCollection<RecordType>;
  }

  /** Expose the raw MongoDB Db for auth infrastructure (AuthCollection). */
  public getMongoDb(): Promise<Db> { return this.#db; }

  public async clear() {
    const db = await this.#db;
    const collections = await db.collections();
    for (const collection of collections) {
      await collection.drop();
    }
  }

  public onChange(callback: (event: ServerDbChangeEvent) => void): Unsubscribe {
    const scope = AsyncLocalStorage.snapshot();
    const callbackWrapper = (event: ServerDbChangeEvent) => scope(() => callback(event));
    this.#changeCallbacks.add(callbackWrapper);
    return () => this.#changeCallbacks.delete(callbackWrapper);
  }

  #resetConnectBackoff() {
    this.#connectBackoffMsPrev = 500;
    this.#connectBackoffMsCurr = 500;
    this.#connectAttempt = 0;
  }

  /** Next wait before retry; advances Fibonacci state (capped at 60s). */
  #nextConnectDelayMs(): number {
    const capMs = 60_000;
    const delayMs = Math.min(capMs, this.#connectBackoffMsCurr);
    const nextCurr = Math.min(capMs, this.#connectBackoffMsPrev + this.#connectBackoffMsCurr);
    this.#connectBackoffMsPrev = this.#connectBackoffMsCurr;
    this.#connectBackoffMsCurr = nextCurr;
    return delayMs;
  }

  #connect() {
    const attemptToConnect = async (): Promise<Db> => {
      this.#connectAttempt += 1;
      const attempt = this.#connectAttempt;
      this.#logger.info(`Connecting to database "${this.#mongoDbName}" (attempt ${attempt})...`);
      try {
        await this.#client.connect();
        const db = this.#client.db(this.#mongoDbName);
        this.#resetConnectBackoff();
        this.#logger.info(`Connected to database "${this.#mongoDbName}" after ${attempt} attempt(s).`);
        this.#startWatching(db);
        return db;
      } catch (error) {
        const delayMs = this.#nextConnectDelayMs();
        if (error instanceof Error) {
          this.#logger.error(
            `Failed to connect to database (attempt ${attempt}), retrying in ${delayMs}ms — could this be that this server's IP address is not configured on Atlas?`,
            { error: error.message, attempt, delayMs },
          );
        } else {
          this.#logger.error(`Failed to connect to database (attempt ${attempt}), retrying in ${delayMs}ms`, { error, attempt, delayMs });
        }
        await Promise.delay(delayMs);
        return attemptToConnect();
      }
    };
    return this.#db = attemptToConnect();
  }

  #setupEvents() {
    const client = this.#client;
    const logger = this.#logger;

    client.on('error', error => {
      logger.error('Database direct error', { error });
    });

    client.on('commandStarted', event => {
      logger.debug('Database command started', { event });
    });

    client.on('commandFailed', event => {
      logger.debug('Database command failed', { event });
    });

    client.on('commandSucceeded', event => {
      logger.debug('Database command succeeded', { event });
    });

    client.on('connectionClosed', event => {
      logger.debug('Database connection closed unexpectedly', { event });
      this.#connect();
    });

    client.on('close', () => {
      this.#changeStream?.close();
      logger.debug('Database connection closed');
    });
  }

  #setupCollections(collections: MXDBCollection[]) {
    let collectionNamesPromise: Promise<Set<string>> | undefined;
    const getCollectionNames = async () => {
      if (collectionNamesPromise != null) return collectionNamesPromise;
      return collectionNamesPromise = (async () => {
        const db = await this.#db;
        const collectionNames = (await db.listCollections().toArray()).map(collection => collection.name);
        return new Set(collectionNames);
      })();
    };
    return new Map(collections.map(collection => [collection.name, new ServerDbCollection({ getDb: () => this.#db, collectionNames: getCollectionNames(), collection, logger: this.#logger })]));
  }

  async #runExtensionHooksAfterChange(event: ServerDbChangeEvent) {
    const dbCollection = this.#collections.get(event.collectionName);
    if (dbCollection == null) return;
    const extensions = getCollectionExtensions(dbCollection.collection);
    if (extensions == null) return;

    const run = () => {
      if (event.type === 'delete') {
        return extensions.onAfterDelete?.({ recordIds: event.recordIds });
      }
      const insertedIds = event.type === 'insert' ? event.records.ids() : [];
      const updatedIds = event.type === 'update' ? event.records.ids() : [];
      return extensions.onAfterUpsert?.({ records: event.records, insertedIds, updatedIds });
    };

    try {
      await Promise.resolve(run());
    } catch (error) {
      this.#logger.error('Extension onAfter hook failed', { collectionName: event.collectionName, type: event.type, error });
    }
  }

  #changeStreamDocumentId(change: ChangeStreamDocument<MongoDocOf<Record>>): string | undefined {
    if ('documentKey' in change && change.documentKey != null && '_id' in change.documentKey) {
      return String((change.documentKey as { _id: unknown })._id);
    }
    if ('fullDocument' in change && change.fullDocument != null && '_id' in change.fullDocument) {
      return String((change.fullDocument as { _id: unknown })._id);
    }
    return undefined;
  }

  #startWatching(db: Db) {
    const changeStream = this.#changeStream = db.watch([{ $project: { something: false } }], { fullDocumentBeforeChange: 'whenAvailable' });
    changeStream.on('change', change => {
      const collectionName: string | undefined = 'ns' in change && change.ns != null && 'coll' in change.ns ? change.ns.coll : undefined;
      const op = 'operationType' in change ? change.operationType : undefined;
      const documentId = this.#changeStreamDocumentId(change as ChangeStreamDocument<MongoDocOf<Record>>);

      if (is.blank(collectionName)) {
        this.#logger.silly('changeStream:ignore (no collection ns)', { operationType: op, documentId });
        return;
      }
      const collection = this.#collections.get(collectionName);
      if (collection == null) {
        this.#logger.silly('changeStream:ignore (collection not in ServerDb config)', { collectionName, operationType: op, documentId });
        return;
      }
      // Ignore changes where the full document is the same as the full document before change
      if ('fullDocument' in change && 'fullDocumentBeforeChange' in change && is.deepEqual(change.fullDocument, change.fullDocumentBeforeChange)) {
        this.#logger.silly('changeStream:ignore (fullDocument unchanged vs before)', { collectionName, operationType: op, documentId });
        return;
      }
      const validOperationType: ServerDbChangeEvent['type'] | undefined = ['create', 'insert'].includes(change.operationType)
        ? 'insert' : ['update', 'replace'].includes(change.operationType) ? 'update' : change.operationType === 'delete' ? 'delete' : undefined;
      if (validOperationType == null) {
        this.#logger.silly('changeStream:ignore (operationType not mapped)', { collectionName, operationType: op, documentId });
        return;
      }

      this.#logger.silly('changeStream:raw event → debounce batch', {
        collectionName,
        mappedType: validOperationType,
        operationType: op,
        documentId,
      });

      const key = `${collectionName}-${validOperationType}`;
      const events = this.#dbEvents.getOrSet(key, () => new ServerDbCollectionEvents({
        collectionName,
        callbacks: this.#changeCallbacks,
        operationType: validOperationType,
        debounceMs: this.#changeStreamDebounceMs,
        onAfterDispatch: event => this.#runExtensionHooksAfterChange(event),
        logger: this.#logger,
      }));
      events.process(change as ChangeStreamDocument<MongoDocOf<Record>>);
    });

  }
}