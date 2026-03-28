import type { Logger, Record } from '@anupheaus/common';
import type { ServerDbChangeEvent } from './server-db-models';
import type { MongoDocOf } from '../../../common';
import type { ChangeStreamDocument } from 'mongodb';
import { dbUtils } from './db-utils';

type OperationType = ServerDbChangeEvent['type'];

/** Default idle window (ms) before dispatching when no stream events have arrived. */
const DEFAULT_DEBOUNCE_MS = 20;

interface Props {
  collectionName: string;
  callbacks: Set<(event: ServerDbChangeEvent) => void>;
  operationType: OperationType;
  /** Idle window (ms) before dispatching; events within this window are batched. Default 20. */
  debounceMs?: number;
  /** Runs before change callbacks; awaited so clients are notified only after this completes. */
  onAfterDispatch?: (event: ServerDbChangeEvent) => void | Promise<void>;
  /** When set, logs batched change-stream output (enable `LOGGING_*` silly/debug for `ServerDb`). */
  logger?: Logger;
}

export class ServerDbCollectionEvents {
  constructor({ collectionName, callbacks, operationType, debounceMs, onAfterDispatch, logger }: Props) {
    this.#collectionName = collectionName;
    this.#callbacks = callbacks;
    this.#operationType = operationType;
    this.#debounceMs = debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#onAfterDispatch = onAfterDispatch;
    this.#logger = logger;
    this.#insertUpdateEvents = new Map();
    this.#deleteEvents = new Set();
  }

  #collectionName: string;
  #operationType: OperationType;
  #debounceMs: number;
  #onAfterDispatch: ((event: ServerDbChangeEvent) => void | Promise<void>) | undefined;
  #logger: Logger | undefined;
  #insertUpdateEvents: Map<string, Record>;
  #deleteEvents: Set<string>;
  #timer: NodeJS.Timeout | undefined;
  #callbacks: Set<(event: ServerDbChangeEvent) => void>;

  public process(streamEvent: ChangeStreamDocument<MongoDocOf<Record>>) {
    this.#clearTimer();
    switch (this.#operationType) {
      case 'insert':
      case 'update': {
        const record = 'fullDocument' in streamEvent && streamEvent.fullDocument != null ? dbUtils.deserialize(streamEvent.fullDocument) : undefined;
        if (record != null) {
          this.#insertUpdateEvents.set(record.id, record);
          const updatedAt = (record as { updatedAt?: number }).updatedAt;
          this.#logger?.silly('changeStream:batch add (insert/update)', {
            collection: this.#collectionName,
            recordId: record.id,
            updatedAt,
            pendingBatchSize: this.#insertUpdateEvents.size,
          });
        }
        break;
      }
      case 'delete': {
        const recordId = 'documentKey' in streamEvent && streamEvent.documentKey != null && '_id' in streamEvent.documentKey ? streamEvent.documentKey._id.toString() : undefined;
        if (recordId == null) return;
        this.#deleteEvents.add(recordId);
        this.#logger?.silly('changeStream:batch add (delete)', {
          collection: this.#collectionName,
          recordId,
          pendingBatchSize: this.#deleteEvents.size,
        });
        break;
      }
    }
    this.#startTimer();
  }

  #clearTimer() {
    if (this.#timer == null) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #startTimer() {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#dispatchEvents();
    }, this.#debounceMs);
  }

  async #dispatchEvents() {
    const operationType = this.#operationType;
    const deleteIds = operationType === 'delete' ? Array.from(this.#deleteEvents) : [];
    const upsertRecords = operationType !== 'delete' ? Array.from(this.#insertUpdateEvents.values()) : [];

    const event: ServerDbChangeEvent = operationType === 'delete'
      ? { collectionName: this.#collectionName, type: 'delete', recordIds: deleteIds }
      : { collectionName: this.#collectionName, type: operationType, records: upsertRecords };

    if (operationType === 'delete') {
      this.#deleteEvents.clear();
    } else {
      this.#insertUpdateEvents.clear();
    }

    if (operationType === 'delete') {
      this.#logger?.debug('changeStream:dispatch (debounced)', {
        collection: this.#collectionName,
        type: 'delete',
        recordIds: deleteIds,
        subscriberCount: this.#callbacks.size,
      });
    } else {
      const ids = upsertRecords.ids();
      const updatedAts = upsertRecords.map((r: Record) => (r as { updatedAt?: number }).updatedAt);
      this.#logger?.debug('changeStream:dispatch (debounced)', {
        collection: this.#collectionName,
        type: operationType,
        recordIds: ids,
        updatedAts,
        subscriberCount: this.#callbacks.size,
      });
    }

    await Promise.resolve(this.#onAfterDispatch?.(event));
    this.#callbacks.forEach(callback => callback(event));
  }
}
