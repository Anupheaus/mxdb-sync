// import type { Record } from '@anupheaus/common';
// import { useContext } from 'react';
// import { UseRecordContext } from './UseRecordContext';
// import type { MXDBSyncedCollection } from '../../../common';

// export function useRecordFrom<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>, isRequired?: boolean) {
//   const { isValid, records } = useContext(UseRecordContext);
//   if (!isValid) throw new Error('useRecordFrom must be used inside UseRecord component.');
//   const recordState = records.get(collection.name);
//   if (!recordState || (recordState.record == null && recordState.isLoading === false)) throw new Error(`A "${collection.name}" record has not been provided for this component and one is required.`);
//   return recordState;
// }