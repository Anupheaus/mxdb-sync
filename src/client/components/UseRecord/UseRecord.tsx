// import type { Record } from '@anupheaus/common';
// import { createComponent } from '@anupheaus/react-ui';
// import type { MXDBSyncedCollection } from '../../../common';
// import type { ReactNode } from 'react';
// import { UseRecordWithRecord } from './UseRecordWithRecord';
// import { UseRecordWithRecordId } from './UseRecordWithRecordId';

// interface WithRecordProps<RecordType extends Record> {
//   record: RecordType;
// }

// interface WithRecordIdProps {
//   id: string;
// }

// type Props<RecordType extends Record> = (WithRecordProps<RecordType> | WithRecordIdProps) & {
//   collection: MXDBSyncedCollection<RecordType>;
//   children?: ReactNode;
// };

// export const UseRecord = createComponent('UseCollection', function <RecordType extends Record>({
//   collection,
//   children,
//   ...props
// }: Props<RecordType>) {
//   if ('record' in props) {
//     return (
//       <UseRecordWithRecord collectionName={collection.name} record={props.record}>
//         {children}
//       </UseRecordWithRecord>
//     );
//   } else {
//     return (
//       <UseRecordWithRecordId collection={collection} recordId={props.id}>
//         {children}
//       </UseRecordWithRecordId>
//     );
//   }
// });