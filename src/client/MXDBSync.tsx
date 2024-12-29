import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useLayoutEffect, useState } from 'react';
import { SyncProvider, SocketProvider, SyncCollection, CollectionsProvider, PushCollection } from './providers';
import type { MXDBSyncedCollection } from '../common';
import type { MXDBCollection } from '@anupheaus/mxdb';
import { MXDB } from '@anupheaus/mxdb';
import { LoggerProvider } from './logger';
import { configRegistry, syncCollectionRegistry } from '../common/registries';
import { QuerySubscriptionProvider } from './providers/query/QuerySubscriptionProvider';

interface Props {
  name: string;
  collections: MXDBSyncedCollection[];
  children?: ReactNode;
}

export const MXDBSync = createComponent('MXDBSync', ({
  name,
  collections,
  children,
}: Props) => {
  const [mxdbCollections, setMXDBCollections] = useState<MXDBCollection[]>([]);

  useLayoutEffect(() => {
    (async () => {
      const newCollections: MXDBCollection[] = [];
      collections.forEach(collection => {
        const config = configRegistry.get(collection);
        if (config == null) throw new Error(`No config found for collection "${collection.name}"`);
        newCollections.push(collection);
        const syncCollection = syncCollectionRegistry.getForClient(collection);
        if (syncCollection != null) newCollections.push(syncCollection);
      });
      setMXDBCollections(newCollections);
    })();
  }, [Object.hash(collections)]);


  if (mxdbCollections.length !== (collections.length * 2)) return null;

  return (
    <LoggerProvider>
      <SocketProvider>
        <MXDB name={name} collections={mxdbCollections}>
          <SyncProvider>
            <CollectionsProvider collections={collections}>
              <SyncCollection />
              <PushCollection />
            </CollectionsProvider>
            <QuerySubscriptionProvider>
              {children}
            </QuerySubscriptionProvider>
          </SyncProvider>
        </MXDB>
      </SocketProvider>
    </LoggerProvider>
  );
});
