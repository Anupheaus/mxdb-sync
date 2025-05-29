import { createContext } from 'react';
import type { MXDBCollection } from '../../../common';

export const CollectionContext = createContext<MXDBCollection>(null as unknown as MXDBCollection);
