import { useContext } from 'react';
import { DbsContext } from './DbContext';
import { InternalError, is } from '@anupheaus/common';

export function useDb(name?: string) {
  const { dbs, lastDb } = useContext(DbsContext);
  if (is.empty(lastDb)) throw new InternalError('No MXDB context found');
  const context = dbs.get(name ?? lastDb);
  if (context == null) throw new InternalError(`No MXDB context found with the name "${name ?? lastDb}"`);
  return context;
}
