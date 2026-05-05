import type { AnyObject, DataFilters, Record as CommonRecord } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBCollection, QueryProps } from '../../../common';
import type { ExtensionsType, RecordTypeOfCollection, RemoveDasherized } from '../../../common/models';
import { useCollection } from '../../collections/useCollection';

type CommonServerUseRecord<Name extends string, T extends CommonRecord> =
  & { [key in Name as `upsert${Capitalize<RemoveDasherized<Name>>}`]: (record: T) => Promise<void>; }
  & { [key in Name as `remove${Capitalize<RemoveDasherized<Name>>}`]: () => Promise<boolean>; }
  & { [key in Name as `isNew${Capitalize<RemoveDasherized<Name>>}`]: boolean; };

export type ServerUseRecord<Name extends string, T extends CommonRecord, Helpers extends AnyObject = {}> = {
  [key in Name as RemoveDasherized<Name>]: T | undefined;
} & CommonServerUseRecord<Name, T> & Helpers;

type HelpersFunction<Name extends string, T extends CommonRecord, HelperResults extends AnyObject> =
  (context: ServerUseRecord<Name, T>) => HelperResults;

export interface CreateUseRecordOptions<
  Name extends string,
  T extends CommonRecord,
  Args extends unknown[],
  HelperResults extends AnyObject,
  Extensions extends ExtensionsType,
> {
  hydrateRecord(record: T | undefined, ...args: Args): T;
  helpers?: HelpersFunction<Name, T, HelperResults>;
  extensions?: Extensions;
}

type UseRecordHook<
  Name extends string,
  T extends CommonRecord,
  Args extends unknown[],
  HelperResults extends AnyObject,
  Extensions extends ExtensionsType,
> = ((id: string | undefined, ...args: Args) => Promise<ServerUseRecord<Name, T, HelperResults>>) & {
  get(id: string): Promise<T | undefined>;
  get(ids: string[]): Promise<T[]>;
  getAll(): Promise<T[]>;
  find(filters: DataFilters<T>): Promise<T | undefined>;
  query(props?: QueryProps<T>): Promise<T[]>;
  distinct<K extends keyof T>(field: K, props?: { filters?: DataFilters<T> }): Promise<T[K][]>;
} & Extensions;

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

  async function useRecord(id: string | undefined, ...args: Args): Promise<ServerUseRecord<Name, T, HelperResults>> {
    const { get, upsert, remove } = useCollection(collection);
    const loadedRecord = id != null ? await get(id) : undefined;
    const hydratedRecord = hydrateRecord(loadedRecord, ...args);
    const record = id != null && hydratedRecord != null
      ? { ...(hydratedRecord as CommonRecord), id } as T
      : hydratedRecord;
    const isNew = loadedRecord == null;

    const removeFn = async (): Promise<boolean> => {
      if (record == null) return false;
      await remove(record);
      return true;
    };

    const baseResult = {
      [camelName]: record,
      [`upsert${pascalName}`]: (record: T) => upsert(record),
      [`remove${pascalName}`]: removeFn,
      [`isNew${pascalName}`]: isNew,
    } as ServerUseRecord<Name, T>;

    const helperResults = helpers?.(baseResult);

    return { ...baseResult, ...helperResults } as ServerUseRecord<Name, T, HelperResults>;
  }

  async function staticGet(id: string): Promise<T | undefined>;
  async function staticGet(ids: string[]): Promise<T[]>;
  async function staticGet(idOrIds: string | string[]): Promise<T | undefined | T[]> {
    const { get } = useCollection(collection);
    return get(idOrIds as any);
  }

  async function staticGetAll(): Promise<T[]> {
    const { getAll } = useCollection(collection);
    return getAll();
  }

  async function staticFind(filters: DataFilters<T>): Promise<T | undefined> {
    const { find } = useCollection(collection);
    return find(filters);
  }

  async function staticQuery(props?: QueryProps<T>): Promise<T[]> {
    const { query } = useCollection(collection);
    const { data } = await query(props ?? {});
    return data;
  }

  async function staticDistinct<K extends keyof T>(field: K, props?: { filters?: DataFilters<T> }): Promise<T[K][]> {
    const { distinct } = useCollection(collection);
    const records = await distinct({ field, ...props });
    return records.map(r => r[field]);
  }

  (useRecord as any).get = staticGet;
  (useRecord as any).getAll = staticGetAll;
  (useRecord as any).find = staticFind;
  (useRecord as any).query = staticQuery;
  (useRecord as any).distinct = staticDistinct;

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
