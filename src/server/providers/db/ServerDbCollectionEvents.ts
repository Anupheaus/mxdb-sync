import type { Record } from '@anupheaus/common';
import type { ServerDbChangeEvent } from './server-db-models';
import type { MongoDocOf } from '../../../common';
import type { ChangeStreamDocument } from 'mongodb';
import { dbUtils } from './db-utils';

type OperationType = ServerDbChangeEvent['type'];

interface Props {
  collectionName: string;
  callbacks: Set<(event: ServerDbChangeEvent) => void>;
  operationType: OperationType;
}

export class ServerDbCollectionEvents {
  constructor({ collectionName, callbacks, operationType }: Props) {
    this.#collectionName = collectionName;
    this.#callbacks = callbacks;
    this.#operationType = operationType;
    this.#insertUpdateEvents = new Map();
    this.#deleteEvents = new Set();
  }

  #collectionName: string;
  #operationType: OperationType;
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
        if (record != null) this.#insertUpdateEvents.set(record.id, record);
        break;
      }
      case 'delete': {
        const recordId = 'documentKey' in streamEvent && streamEvent.documentKey != null && '_id' in streamEvent.documentKey ? streamEvent.documentKey._id.toString() : undefined;
        if (recordId == null) return;
        this.#deleteEvents.add(recordId);
        break;
      }
    }
    this.#startTimer();
  }

  #clearTimer() {
    if (this.#timer != null) return;
    clearTimeout(this.#timer);
  }

  #startTimer() {
    this.#timer = setTimeout(() => {
      this.#dispatchEvents();
    }, 1000);
  }

  #dispatchEvents() {
    const operationType = this.#operationType;
    if (operationType === 'delete') {
      const recordIds = Array.from(this.#deleteEvents);
      this.#callbacks.forEach(callback => callback({ collectionName: this.#collectionName, type: 'delete', recordIds }));
      this.#deleteEvents.clear();
    } else {
      const records = Array.from(this.#insertUpdateEvents.values());
      this.#callbacks.forEach(callback => callback({ collectionName: this.#collectionName, type: operationType, records }));
      this.#insertUpdateEvents.clear();
    }
  }

}
