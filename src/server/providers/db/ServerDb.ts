import type { MongoDocOf, MXDBCollection } from '../../../common';
import type { ChangeStream, ChangeStreamDocument, Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import { ServerDbCollection } from './ServerDbCollection';
import { ServerDbCollectionEvents } from './ServerDbCollectionEvents';
import type { ServerDbChangeEvent } from './server-db-models';
import type { AnyFunction } from '@anupheaus/common';
import { is, type Logger, type Record, type Unsubscribe } from '@anupheaus/common';
import { DbProvider } from './DbContext';
import { AsyncLocalStorage } from 'async_hooks';

interface Props {
  mongoDbName: string;
  mongoDbUrl: string;
  collections: MXDBCollection[];
  logger: Logger;
}

export class ServerDb {
  constructor(props: Props) {
    this.#mongoDbName = props.mongoDbName;
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

  public use<RecordType extends Record>(collectionName: string) {
    return this.#collections.get(collectionName) as ServerDbCollection<RecordType>;
  }

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

  public wrap<F extends AnyFunction>(delegate: F): F {
    return ((...args: any[]) => DbProvider.run(this, () => delegate(...args))) as F;
  }

  #connect() {
    const attemptToConnect = async (): Promise<Db> => {
      this.#logger.info(`Connecting to database "${this.#mongoDbName}"...`);
      try {
        await this.#client.connect();
        const db = this.#client.db(this.#mongoDbName);
        this.#startWatching(db);
        return db;
      } catch (error) {
        if (error instanceof Error) {
          this.#logger.error('Failed to connect to database, could this be that this server\'s IP address is not configured on Atlas?');
        } else {
          this.#logger.error('Failed to connect to database', { error });
        }
        await Promise.delay(10000);
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

  #startWatching(db: Db) {
    const changeStream = this.#changeStream = db.watch([{ $project: { something: false } }], { fullDocumentBeforeChange: 'whenAvailable' });
    changeStream.on('change', change => {
      const collectionName: string | undefined = 'ns' in change && change.ns != null && 'coll' in change.ns ? change.ns.coll : undefined;
      if (is.blank(collectionName)) return;
      const collection = this.#collections.get(collectionName);
      if (collection == null) return;
      // Ignore changes where the full document is the same as the full document before change
      if ('fullDocument' in change && 'fullDocumentBeforeChange' in change && is.deepEqual(change.fullDocument, change.fullDocumentBeforeChange)) return;
      const validOperationType: ServerDbChangeEvent['type'] | undefined = ['create', 'insert'].includes(change.operationType)
        ? 'insert' : ['update', 'replace'].includes(change.operationType) ? 'update' : change.operationType === 'delete' ? 'delete' : undefined;
      if (validOperationType == null) return;
      const key = `${collectionName}-${validOperationType}`;
      const events = this.#dbEvents.getOrSet(key, () => new ServerDbCollectionEvents({ collectionName, callbacks: this.#changeCallbacks, operationType: validOperationType }));
      events.process(change as ChangeStreamDocument<MongoDocOf<Record>>);
    });

  }
}