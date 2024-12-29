import { createComponent } from '@anupheaus/react-ui';
import { useMemo, type ReactNode } from 'react';
import type { MXDBSyncedCollection } from '../../../common';
import { CollectionProvider } from './CollectionProvider';

interface Props {
  collections: MXDBSyncedCollection[];
  children?: ReactNode;
}

export const CollectionsProvider = createComponent('CollectionProvider', ({
  collections,
  children,
}: Props) => {
  const renderedCollections = useMemo(() => collections.map(collection => (
    <CollectionProvider key={collection.name} collection={collection}>
      {children}
    </CollectionProvider>
  )), [collections]);

  return (
    <>{renderedCollections}</>
  );
});