import { createContext } from 'react';
import type { MXDBSyncedCollection } from '../../../common';

export const CollectionContext = createContext<MXDBSyncedCollection>(null as unknown as MXDBSyncedCollection);
