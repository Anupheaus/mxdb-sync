import type { AnyObject, DataFilters, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBCollection, MXDBError, QueryProps } from '../../../common';
import type { AddDebugTo, AddDisableTo, ExtensionsType, RecordTypeOfCollection, RemoveDasherized } from '../../../common/models';
import { useCollection } from '../useCollection/useCollection';
import { useStableHelpers } from '../useStableHelpers';

type UseCollectionResult<T extends Record> = ReturnType<typeof useCollection<T>>;

type UseRecordsQueryResult<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T[]; }
  & { [key in Name as `total${Capitalize<RemoveDasherized<Name>>}`]: number; };

export type UseRecords<Name extends string, T extends Record, Helpers extends AnyObject = {}> =
  & { [key in Name as `remove${Capitalize<RemoveDasherized<Name>>}`]: (records: T[] | string[]) => Promise<void>; }
  & { [key in Name as `upsert${Capitalize<RemoveDasherized<Name>>}`]: (records: T | T[]) => Promise<void>; }
  & { [key in Name as `query${Capitalize<RemoveDasherized<Name>>}`]: (props?: QueryProps<T>) => Promise<UseRecordsQueryResult<Name, T>>; }
  & { [key in Name as `get${Capitalize<RemoveDasherized<Name>>}`]: UseCollectionResult<T>['get']; }
  & Helpers;

export type UseRecordsQuery<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T[]; }
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; }
  & { [key in Name as `total${Capitalize<RemoveDasherized<Name>>}`]: number; };

type UseStaticGet<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T | undefined; }
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; }
  & { error?: MXDBError; };

type UseStaticGetAll<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T[]; }
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; }
  & { error?: MXDBError; };

type UseStaticFind<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T | undefined; }
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; };

type UseStaticDistinct<Name extends string, T extends Record, K extends keyof T = keyof T> =
  & { values: T[K][]; error?: MXDBError; }
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; };

const isQueryProps = (arg: unknown): arg is QueryProps<Record> =>
  is.plainObject(arg) && ('filters' in arg || 'disable' in arg || 'sorts' in arg || 'pagination' in arg);

interface UseRecordsOptions<T extends Record, HelperResults extends AnyObject, Extensions extends ExtensionsType> {
  additionalQueryProps?: QueryProps<T>;
  extensions?: Extensions;
  helpers?(): HelperResults;
}

interface QueryHook<Name extends string, T extends Record> {
  (): UseRecordsQuery<Name, T>;
  (recordOrIds: Array<T | string> | undefined): UseRecordsQuery<Name, T>;
  (queryProps: QueryProps<T>): UseRecordsQuery<Name, T>;
}

type UseRecordsHook<Name extends string, T extends Record, Helpers extends AnyObject, Extensions extends ExtensionsType> =
  & (() => UseRecords<Name, T, Helpers>)
  & { query: QueryHook<Name, T> }
  & { get: (id: string | undefined) => UseStaticGet<Name, T> }
  & { getAll: (props?: AddDebugTo<AddDisableTo<object>>) => UseStaticGetAll<Name, T> }
  & { find: (filters: DataFilters<T>) => UseStaticFind<Name, T> }
  & { distinct: <K extends keyof T>(field: K) => UseStaticDistinct<Name, T, K> }
  & Extensions;

export function createUseRecords<
  Name extends string,
  Collection extends MXDBCollection,
  HelperResults extends AnyObject = {},
  Extensions extends ExtensionsType = {},
>(
  name: Name,
  collection: Collection,
  {
    additionalQueryProps,
    extensions,
    helpers,
  }: UseRecordsOptions<RecordTypeOfCollection<Collection>, HelperResults, Extensions> = {},
) {
  type T = RecordTypeOfCollection<Collection>;
  const nameAsCamelCase = name.toVariableName();
  const nameAsPascalCase = name.toVariableName('pascal');

  function useRecords(): UseRecords<Name, T, HelperResults> {
    const { upsert, remove, query, get } = useCollection(collection);
    const rawHelpers = helpers?.();
    const helperResults = useStableHelpers(rawHelpers);

    return {
      [`upsert${nameAsPascalCase}`]: upsert,
      [`remove${nameAsPascalCase}`]: remove,
      [`query${nameAsPascalCase}`]: async (props?: QueryProps<T>) => {
        const { records, total } = await query(props ?? {});
        return { [nameAsCamelCase]: records, [`total${nameAsPascalCase}`]: total } as UseRecordsQueryResult<Name, T>;
      },
      [`get${nameAsPascalCase}`]: get,
      ...helperResults,
    } as UseRecords<Name, T, HelperResults>;
  }

  function useRecordsQuery(): UseRecordsQuery<Name, T>;
  function useRecordsQuery(recordOrIds: Array<T | string> | undefined): UseRecordsQuery<Name, T>;
  function useRecordsQuery(queryProps: QueryProps<T>): UseRecordsQuery<Name, T>;
  function useRecordsQuery(...args: unknown[]): UseRecordsQuery<Name, T> {
    const { useQuery } = useCollection(collection);
    const recordsOrIds = args[0] instanceof Array ? args[0] as Array<T | string> : undefined;
    const recordIds = recordsOrIds?.map(item => (typeof item === 'string' ? item : (item as Record).id));
    const resolvedQueryProps: QueryProps<T> =
      args.length === 0 ? (additionalQueryProps ?? {}) :
        recordIds != null ? { ...additionalQueryProps, filters: { id: { $in: recordIds } } as QueryProps<T>['filters'], disable: recordIds.length === 0 } :
          isQueryProps(args[0]) ? { ...additionalQueryProps, ...args[0] as QueryProps<T> } :
            additionalQueryProps ?? {};

    const { records, isLoading, total } = useQuery(resolvedQueryProps);

    return {
      [nameAsCamelCase]: records,
      [`isLoading${nameAsPascalCase}`]: isLoading,
      [`total${nameAsPascalCase}`]: total,
    } as UseRecordsQuery<Name, T>;
  }

  function useRecordsGet(id: string | undefined): UseStaticGet<Name, T> {
    const { useGet } = useCollection(collection);
    const { record, isLoading, error } = useGet(id);
    return {
      [nameAsCamelCase]: record,
      [`isLoading${nameAsPascalCase}`]: isLoading,
      error,
    } as UseStaticGet<Name, T>;
  }

  function useRecordsGetAll(props?: AddDebugTo<AddDisableTo<object>>): UseStaticGetAll<Name, T> {
    const { useGetAll } = useCollection(collection);
    const { records, isLoading, error } = useGetAll(props);
    return {
      [nameAsCamelCase]: records,
      [`isLoading${nameAsPascalCase}`]: isLoading,
      error,
    } as UseStaticGetAll<Name, T>;
  }

  function useRecordsFind(filters: DataFilters<T>): UseStaticFind<Name, T> {
    const { useQuery } = useCollection(collection);
    const { records, isLoading } = useQuery({ filters });
    return {
      [nameAsCamelCase]: records[0] as T | undefined,
      [`isLoading${nameAsPascalCase}`]: isLoading,
    } as UseStaticFind<Name, T>;
  }

  function useRecordsDistinct<K extends keyof T>(field: K): UseStaticDistinct<Name, T, K> {
    const { useDistinct } = useCollection(collection);
    const { values, isLoading, error } = useDistinct(field);
    return {
      values: values as T[K][],
      [`isLoading${nameAsPascalCase}`]: isLoading,
      error,
    } as UseStaticDistinct<Name, T, K>;
  }

  (useRecords as any).query = useRecordsQuery;
  (useRecords as any).get = useRecordsGet;
  (useRecords as any).getAll = useRecordsGetAll;
  (useRecords as any).find = useRecordsFind;
  (useRecords as any).distinct = useRecordsDistinct;

  if (is.plainObject(extensions)) {
    Object.entries(extensions).forEach(([key, fn]) => {
      (useRecords as any)[key] = fn;
    });
  }

  return useRecords as UseRecordsHook<Name, T, HelperResults, Extensions>;
}
