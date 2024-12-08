import { DateTime } from 'luxon';
import type { MXDBSyncRecord } from './internalModels';
import type { Record } from '@anupheaus/common';
import { to } from '@anupheaus/common';

export function generateSyncTime() {
  return DateTime.now().toUTC().valueOf();
}

export function isNewer<RecordType extends Record>(record: MXDBSyncRecord<RecordType> | undefined, syncTime: number) {
  if (record == null) return false;
  const allTimestamps = Object.keys(record.audit ?? {}).map<number | undefined>(to.number).concat(record.original?.timestamp).removeNull();
  if (allTimestamps.length === 0) return false;
  return allTimestamps.some(timestamp => timestamp > syncTime);
}
