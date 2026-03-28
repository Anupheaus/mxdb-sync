/**
 * Mirrors the current auth token and keyHash into the SQLite `mxdb_authentication`
 * table whenever they change. Must be rendered inside a `DbsProvider`.
 *
 * This keeps the encrypted per-user SQLite DB in sync with the IndexedDB copy
 * so that the credentials survive in the encrypted store between sessions.
 */

import { createComponent } from '@anupheaus/react-ui';
import { useEffect } from 'react';
import { useDb } from '../providers/dbs';

interface Props {
  token: string;
  keyHash: string;
}

export const SqliteTokenSync = createComponent('SqliteTokenSync', ({ token, keyHash }: Props) => {
  const { db } = useDb();

  useEffect(() => {
    db.writeAuth(token, keyHash);
  }, [token, keyHash, db]);

  return null;
});
