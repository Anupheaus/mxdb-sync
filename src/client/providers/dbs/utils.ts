import { type Record } from '@anupheaus/common';
import { serialise } from './transforms';

interface WebWorkerPayload {
  dbName: string;
  collectionName: string;
  action: 'upsert' | 'delete' | 'clear';
  records?: Record[];
  ids?: string[];
}

function webWorkerCode() {

  function wrap<T = unknown>(value: IDBRequest<T>): Promise<T>;
  function wrap(value: IDBTransaction): Promise<void>;
  function wrap(value: IDBRequest | IDBTransaction): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if ('oncomplete' in value) {
        value.oncomplete = () => resolve(void 0);
      } else {
        value.onsuccess = () => resolve(value.result);
      }
      value.onerror = () => reject(value.error);
    });
  }

  const WGS = (self as any)['WorkerGlobalScope'] as typeof Object | undefined;
  if (WGS !== undefined && self instanceof WGS) {
    self.addEventListener('message', ({ data: { dbName, collectionName, action, records, ids } }: MessageEvent<WebWorkerPayload>) => {
      const request = self.indexedDB.open(dbName);
      wrap(request).then(db => {
        const transaction = db.transaction(collectionName, 'readwrite');
        const collection = transaction.objectStore(collectionName);
        const complete = () => { transaction.commit(); };
        switch (action) {
          case 'upsert':
            // eslint-disable-next-line no-console
            if (records == null) { console.error('Records are required'); return; }
            Promise.allSettled(records.map(record => wrap(collection.put(record)))).then(complete);
            break;
          case 'delete':
            // eslint-disable-next-line no-console
            if (ids == null) { console.error('Ids are required'); return; }
            Promise.allSettled(ids.map(id => wrap(collection.delete(id)))).then(complete);
            break;
          case 'clear':
            wrap(collection.clear()).then(complete);
            break;
          default:
            // eslint-disable-next-line no-console
            console.error(`Unknown action: ${action}`);
        }
      });
    });
  }

  return wrap;
}

const webWorker = new Worker(URL.createObjectURL(new Blob([`(${webWorkerCode.toString()})()`], { type: 'text/javascript' })));

function upsertRecordUsingWebWorker(dbName: string, collectionName: string, records: Record[]) {
  const rawRecords = records.map(record => serialise(record));
  const payload: WebWorkerPayload = { dbName, collectionName, action: 'upsert', records: rawRecords };
  webWorker.postMessage(payload);
}

function deleteRecordUsingWebWorker(dbName: string, collectionName: string, ids: string[]) {
  const payload: WebWorkerPayload = { dbName, collectionName, action: 'delete', ids };
  webWorker.postMessage(payload);
}

function clearRecordUsingWebWorker(dbName: string, collectionName: string) {
  const payload: WebWorkerPayload = { dbName, collectionName, action: 'clear' };
  webWorker.postMessage(payload);
}

export const utils = {
  wrap: webWorkerCode(),
  upsertRecordUsingWebWorker,
  deleteRecordUsingWebWorker,
  clearRecordUsingWebWorker,
};

