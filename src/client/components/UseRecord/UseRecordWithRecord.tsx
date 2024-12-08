// import { createComponent } from '@anupheaus/react-ui';
// import { useContext, useMemo, type ReactNode } from 'react';
// import type { Record } from '@anupheaus/common';
// import type { UseRecordContextProps } from './UseRecordContext';
// import { UseRecordContext } from './UseRecordContext';

// interface Props {
//   collectionName: string;
//   record: Record;
//   children?: ReactNode;
// }

// export const UseRecordWithRecord = createComponent('UseRecordWithRecord', ({ collectionName, record, children }: Props) => {
//   const { records } = useContext(UseRecordContext);

//   const context = useMemo<UseRecordContextProps>(() => ({
//     isValid: true,
//     records: records.clone().set(collectionName, { record, isLoading: false }),
//   }), [record]);
//   return (
//     <UseRecordContext.Provider value={context}>
//       {children}
//     </UseRecordContext.Provider>
//   );
// });
