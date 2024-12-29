import type { Record } from '@anupheaus/common';
import { defineEvent } from './defineEvent';

export interface MXDBPushRecordsEventPayload {
  collectionName: string;
  records: Record[];
}

export const mxdbPushRecords = defineEvent<MXDBPushRecordsEventPayload>('mxdb.pushRecords');

export interface MXDBRefreshQueryEventPayload {
  queryId: string;
  total: number;
}

export const mxdbRefreshQuery = defineEvent<MXDBRefreshQueryEventPayload>('mxdb.refreshQuery');
