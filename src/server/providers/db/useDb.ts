import { DbProvider } from './DbContext';

export function useDb() {
  const db = DbProvider.getStore();
  if (db == null) throw new Error('useDb must be used within a provideDb context');
  return db;
}