import type { Record } from '@anupheaus/common';
import { defineEvent } from './defineEvent';

export interface MXDBPushRecordsEventPayload {
  collectionName: string;
  records: Record[];
}

export interface MXDBRemoveRecordsEventPayload {
  collectionName: string;
  ids: string[];
}

export interface MXDBServerPushEventPayload {
  collectionName: string;
  updatedRecords: Record[];
  removedRecordIds: string[];
}

export const mxdbServerPush = defineEvent<MXDBServerPushEventPayload>('mxdbServerRecordsUpdate');

export interface MXDBRefreshQueryEventPayload {
  queryId: string;
  total: number;
}

export const mxdbRefreshQuery = defineEvent<MXDBRefreshQueryEventPayload>('mxdbRefreshQuery');
