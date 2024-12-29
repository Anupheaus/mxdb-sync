import { createComponent } from '@anupheaus/react-ui';
import type { MXDBSyncedCollection } from '../../../common';
import type { ReactNode } from 'react';
import { CollectionContext } from './CollectionContext';

interface Props {
  collection: MXDBSyncedCollection;
  children?: ReactNode;
}

export const CollectionProvider = createComponent('CollectionProvider', ({
  collection,
  children,
}: Props) => {
  return (
    <CollectionContext.Provider value={collection}>
      {children}
    </CollectionContext.Provider>
  );
});
