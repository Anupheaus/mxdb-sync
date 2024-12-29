import { useContext } from 'react';
import { CollectionContext } from './CollectionContext';

export function useCurrentCollection() {
  return useContext(CollectionContext);
}
