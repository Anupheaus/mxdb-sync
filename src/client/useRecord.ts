import { is, type Record } from '@anupheaus/common';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MXDBCollection } from '../common';
import { useCollection } from './hooks/useCollection/useCollection';
import { auditor } from '../common/auditor';
import { ConflictResolutionContext } from './providers';

export type RecordTypeOfCollection<Collection extends MXDBCollection<Record>> = Collection extends MXDBCollection<infer RecordType> ? RecordType : never;

export function useRecord<Collection extends MXDBCollection<Record>>(recordOrId: RecordTypeOfCollection<Collection> | string | undefined, collection: Collection) {
  const { onConflictResolution } = useContext(ConflictResolutionContext);
  const { useGet, upsert, remove } = useCollection<RecordTypeOfCollection<Collection>>(collection as any);

  const id = is.string(recordOrId) ? recordOrId : is.plainObject<RecordTypeOfCollection<Collection>>(recordOrId) ? recordOrId.id : undefined;
  const { record: dbRecord, isLoading, error } = useGet(id);

  const isEditing = is.plainObject<RecordTypeOfCollection<Collection>>(recordOrId);

  // Keep a ref to the latest user record so effects can read it without triggering re-runs
  const recordOrIdRef = useRef(recordOrId);
  useLayoutEffect(() => { recordOrIdRef.current = recordOrId; });

  // Track the last DB state we saw, to compute the server-side delta for rebasing
  const lastDbRecordRef = useRef<RecordTypeOfCollection<Collection> | undefined>(undefined);

  // The rebased working copy — set when the server pushes a new state while user is editing
  const [rebasedRecord, setRebasedRecord] = useState<RecordTypeOfCollection<Collection> | undefined>(undefined);

  useEffect(() => {
    if (!isEditing) {
      // Not in editing mode — just track DB record, no rebase needed
      lastDbRecordRef.current = dbRecord;
      setRebasedRecord(undefined);
      return;
    }

    const oldDbRecord = lastDbRecordRef.current;
    lastDbRecordRef.current = dbRecord;

    if (oldDbRecord == null) return;

    if (dbRecord == null) {
      // §6.4 — Record deleted on server while user was editing
      if (onConflictResolution != null) {
        const userRecord = recordOrIdRef.current as RecordTypeOfCollection<Collection>;
        void onConflictResolution('This record has been deleted by another user. Do you want to restore it?').then(restore => {
          if (restore) void upsert(userRecord);
        });
      }
      return;
    }

    if (is.deepEqual(oldDbRecord, dbRecord)) return;

    // DB changed while user is editing — rebase user's edits on top of new server state (§6.3)
    const userRecord = recordOrIdRef.current as RecordTypeOfCollection<Collection>;
    const rebased = auditor.rebaseRecord(oldDbRecord, userRecord, dbRecord);
    setRebasedRecord(rebased);
  }, [dbRecord, isEditing]);

  // Reset rebased record when editing mode exits
  useEffect(() => {
    if (!isEditing) setRebasedRecord(undefined);
  }, [isEditing]);

  const record = isEditing ? (rebasedRecord ?? recordOrId as RecordTypeOfCollection<Collection>) : dbRecord;

  return {
    record,
    isLoading,
    error,
    upsert,
    remove,
  };
}
