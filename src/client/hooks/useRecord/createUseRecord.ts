import type { AnyObject, Record as CommonRecord } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBCollection } from '../../../common';
import type { ExtensionsType, RecordTypeOfCollection, RemoveDasherized } from '../../../common/models';
import { useRecord as useMXDBRecord } from '../../useRecord';
import { useBound, useDebounce, useOnUnmount, useUpdatableState } from '@anupheaus/react-ui';
import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useStableHelpers } from '../useStableHelpers';

type AutoSave<T extends CommonRecord> = (record: T) => void;

type CommonUseRecord<Name extends string, T extends CommonRecord> =
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; }
  & { [key in Name as `set${Capitalize<RemoveDasherized<Name>>}`]: Dispatch<SetStateAction<T>>; }
  & { [key in Name as `upsert${Capitalize<RemoveDasherized<Name>>}`]: (record: T) => Promise<void>; }
  & { [key in Name as `autoSave${Capitalize<RemoveDasherized<Name>>}`]: AutoSave<T>; }
  & { [key in Name as `remove${Capitalize<RemoveDasherized<Name>>}`]: () => Promise<boolean>; }
  & { [key in Name as `isNew${Capitalize<RemoveDasherized<Name>>}`]: boolean; };

export type UseRecord<Name extends string, T extends CommonRecord, Helpers extends AnyObject = {}> = {
  [key in Name as RemoveDasherized<Name>]: T | undefined;
} & CommonUseRecord<Name, T> & Helpers;

export type NonNullableUseRecord<Name extends string, T extends CommonRecord, Helpers extends AnyObject = {}> = {
  [key in Name as RemoveDasherized<Name>]: T;
} & CommonUseRecord<Name, T> & Helpers;

interface HelpersContext<T extends CommonRecord> {
  recordOrId: T | string | undefined;
}

type HelpersFunction<Name extends string, T extends CommonRecord, HelperResults extends AnyObject> =
  (context: HelpersContext<T> & UseRecord<Name, T>) => HelperResults;

export interface CreateUseRecordOptions<
  Name extends string,
  T extends CommonRecord,
  Args extends unknown[],
  HelperResults extends AnyObject,
  Extensions extends ExtensionsType,
> {
  hydrateRecord(prevRecord: T | undefined, ...args: Args): T;
  helpers?: HelpersFunction<Name, T, HelperResults>;
  extensions?: Extensions;
}

type UseRecordHook<
  Name extends string,
  T extends CommonRecord,
  Args extends unknown[],
  HelperResults extends AnyObject,
  Extensions extends ExtensionsType,
> =
  & ((recordOrId: T | string | undefined) => UseRecord<Name, T, HelperResults>)
  & ((recordOrId: T | string | undefined, createNew: true, ...args: Args) => NonNullableUseRecord<Name, T, HelperResults>)
  & Extensions;

export function createUseRecord<
  Name extends string,
  Collection extends MXDBCollection,
  Args extends unknown[],
  HelperResults extends AnyObject = {},
  Extensions extends ExtensionsType = {},
>(
  name: Name,
  collection: Collection,
  { hydrateRecord, helpers, extensions }: CreateUseRecordOptions<Name, RecordTypeOfCollection<Collection>, Args, HelperResults, Extensions>,
) {
  type T = RecordTypeOfCollection<Collection>;
  const pascalName = name.toVariableName('pascal');
  const camelName = name.toVariableName();

  function useRecord(recordOrId: T | string | undefined): UseRecord<Name, T, HelperResults>;
  function useRecord(recordOrId: T | string | undefined, createNew: true, ...args: Args): NonNullableUseRecord<Name, T, HelperResults>;
  function useRecord(...allArgs: unknown[]): UseRecord<Name, T, HelperResults> {
    const [recordOrId, createNew, ...args] = allArgs;
    const { record: loadedRecord, isLoading: isLoadingRecord, upsert: upsertRecord, remove: removeRecord } =
      useMXDBRecord(recordOrId as any, collection);
    const lastRecordOrIdRef = useRef(recordOrId);
    const isNewRef = useRef(false);

    const [record, setRecord] = useUpdatableState<T | undefined>(prevRecord => {
      if (recordOrId !== lastRecordOrIdRef.current) {
        prevRecord = undefined;
        if (recordOrId == null || loadedRecord != null) lastRecordOrIdRef.current = recordOrId;
      }
      if (loadedRecord == null && !createNew) return prevRecord;
      isNewRef.current = loadedRecord == null && !isLoadingRecord;
      const newRecord = hydrateRecord(
        prevRecord == null && loadedRecord == null ? undefined : { ...prevRecord, ...loadedRecord } as T,
        ...args as Args,
      );
      const idToStamp = typeof recordOrId === 'string' ? recordOrId : recordOrId != null ? (recordOrId as CommonRecord).id : undefined;
      if (idToStamp != null && newRecord != null) newRecord.id = idToStamp;
      return newRecord;
    }, [loadedRecord, isLoadingRecord, recordOrId, ...args]);

    const remove = useBound(async (): Promise<boolean> => {
      if (record == null) return false;
      await removeRecord(record);
      return true;
    });

    // Auto-save: debounces server upserts, flushes on unmount and beforeunload
    const lastAutoSaveRecordRef = useRef<T>();
    const debouncedUpsert = useDebounce(upsertRecord, 30000);
    const flushSave = useBound(async () => {
      if (lastAutoSaveRecordRef.current == null) return;
      const recordToSave = lastAutoSaveRecordRef.current;
      lastAutoSaveRecordRef.current = undefined;
      await upsertRecord(recordToSave);
    });
    useOnUnmount(() => void flushSave());
    useLayoutEffect(() => {
      window.addEventListener('beforeunload', flushSave);
      return () => window.removeEventListener('beforeunload', flushSave);
    }, []);
    const autoSave = useBound((updatedRecord: T) => {
      if (is.deepEqual(updatedRecord, lastAutoSaveRecordRef.current)) return;
      lastAutoSaveRecordRef.current = updatedRecord;
      setRecord(updatedRecord);
      debouncedUpsert(updatedRecord);
    });

    const baseResult = {
      [camelName]: record,
      [`isLoading${pascalName}`]: isLoadingRecord,
      [`set${pascalName}`]: setRecord,
      [`upsert${pascalName}`]: upsertRecord,
      [`remove${pascalName}`]: remove,
      [`isNew${pascalName}`]: isNewRef.current,
      [`autoSave${pascalName}`]: autoSave,
    } as UseRecord<Name, T>;

    const rawHelpers = helpers?.({ recordOrId: recordOrId as T | string | undefined, ...baseResult } as HelpersContext<T> & UseRecord<Name, T>);
    const boundHelpers = useStableHelpers(rawHelpers);

    return { ...baseResult, ...boundHelpers } as UseRecord<Name, T, HelperResults>;
  }

  if (is.plainObject(extensions)) {
    Object.entries(extensions).forEach(([key, fn]) => {
      (useRecord as any)[key] = fn;
    });
  }

  return useRecord as UseRecordHook<Name, T, Args, HelperResults, Extensions>;
}

export type CreateUseRecord<
  Name extends string,
  Collection extends MXDBCollection,
  Args extends unknown[],
  HelperResults extends AnyObject = {},
  Extensions extends ExtensionsType = {},
> = ReturnType<typeof createUseRecord<Name, Collection, Args, HelperResults, Extensions>>;
