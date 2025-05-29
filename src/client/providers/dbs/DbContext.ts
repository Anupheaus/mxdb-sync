import { InternalError, } from '@anupheaus/common';
import { createContext } from 'react';
import type { Db } from './Db';
import type { MXDBCollection } from '../../../common';

export interface DbContextProps {
  db: Db;
  collections: MXDBCollection[];
}

export interface DbsContextProps {
  dbs: Map<string, DbContextProps>;
  lastDb?: string;
}

export const DbsContext = createContext<DbsContextProps>({ dbs: new Map() });

export function createNewDbContext(existingContext: DbsContextProps, db: Db, collections: MXDBCollection[]): DbsContextProps {
  const newDbs = existingContext.dbs.clone();
  if (newDbs.has(db.name)) throw new InternalError(`Database "${db.name}" already exists in the MXDB contexts.`);
  newDbs.set(db.name, { db, collections });
  return { dbs: newDbs, lastDb: db.name };
}
