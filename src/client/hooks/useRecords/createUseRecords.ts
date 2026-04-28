import type { AnyObject, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBCollection, QueryProps } from '../../../common';
import type { ExtensionsType, RecordTypeOfCollection, RemoveDasherized } from '../../../common/models';
import { useCollection } from '../useCollection/useCollection';
import { useMemo, useRef } from 'react';

type UseCollectionResult<T extends Record> = ReturnType<typeof useCollection<T>>;

export type UseRecords<Name extends string, T extends Record, Helpers extends AnyObject = {}> =
  & { [key in Name as `remove${Capitalize<RemoveDasherized<Name>>}`]: (records: T[] | string[]) => Promise<void>; }
  & { [key in Name as `upsert${Capitalize<RemoveDasherized<Name>>}`]: (records: T | T[]) => Promise<void>; }
  & { [key in Name as `query${Capitalize<RemoveDasherized<Name>>}`]: UseCollectionResult<T>['query']; }
  & { [key in Name as `get${Capitalize<RemoveDasherized<Name>>}`]: UseCollectionResult<T>['get']; }
  & Helpers;

export type UseRecordsQuery<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T[]; }
  & { [key in Name as `isLoading${Capitalize<RemoveDasherized<Name>>}`]: boolean; }
  & { [key in Name as `total${Capitalize<RemoveDasherized<Name>>}`]: number; };

const isQueryProps = (arg: unknown): arg is QueryProps<Record> =>
  is.plainObject(arg) && ('filters' in arg || 'disable' in arg || 'sorts' in arg || 'pagination' in arg);

function useStableHelpers<HelperResults extends AnyObject>(rawHelpers: HelperResults | undefined): HelperResults | undefined {
  const latestRef = useRef(rawHelpers);
  latestRef.current = rawHelpers;

  const keysSignature = rawHelpers == null ? '' : Object.keys(rawHelpers).sort().join(',');
  const stableFunctionWrappers = useMemo(() => {
    if (rawHelpers == null) return {};
    const wrappers: AnyObject = {};
    for (const key of Object.keys(rawHelpers)) {
      if (typeof (rawHelpers as AnyObject)[key] === 'function') {
        wrappers[key] = (...args: unknown[]) => (latestRef.current as AnyObject)[key](...args);
      }
    }
    return wrappers;
  }, [keysSignature]);

  if (rawHelpers == null) return undefined;
  return { ...rawHelpers, ...stableFunctionWrappers } as HelperResults;
}

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
      [`query${nameAsPascalCase}`]: query,
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
        recordIds != null ? { filters: { id: { $in: recordIds } }, disable: recordIds.length === 0, ...additionalQueryProps } :
          isQueryProps(args[0]) ? args[0] as QueryProps<T> :
            additionalQueryProps ?? {};

    const { records, isLoading, total } = useQuery(resolvedQueryProps);

    return {
      [nameAsCamelCase]: records,
      [`isLoading${nameAsPascalCase}`]: isLoading,
      [`total${nameAsPascalCase}`]: total,
    } as UseRecordsQuery<Name, T>;
  }

  (useRecords as any).query = useRecordsQuery;

  if (is.plainObject(extensions)) {
    Object.entries(extensions).forEach(([key, fn]) => {
      (useRecords as any)[key] = fn;
    });
  }

  return useRecords as UseRecordsHook<Name, T, HelperResults, Extensions>;
}
