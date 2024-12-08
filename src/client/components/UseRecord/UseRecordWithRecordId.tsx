// import { createComponent } from '@anupheaus/react-ui';
// import { useMemo, type ReactNode } from 'react';
// import type { Record } from '@anupheaus/common';
// import type { UseRecordContextProps } from './UseRecordContext';
// import { UseRecordContext } from './UseRecordContext';
// import type { MXDBSyncedCollection } from '../../../common';
// import { useCollection } from '../../useCollection';

// interface Props<RecordType extends Record> {
//   recordId: string;
//   collection: MXDBSyncedCollection<RecordType>;
//   children?: ReactNode;
// }

// export const UseRecordWithRecordId = createComponent('UseRecordWithRecordId', <RecordType extends Record>({ recordId, collection, children }: Props<RecordType>) => {
//   const { useGet } = useCollection(collection);
//   const { record, isLoading } = useGet(recordId);
//   const context = useMemo<UseRecordContextProps>(() => ({
//     isValid: true,
//     record,
//     isLoading,
//   }), [record, isLoading]);

//   return (
//     <UseRecordContext.Provider value={context}>
//       {children}
//     </UseRecordContext.Provider>
//   );
// });