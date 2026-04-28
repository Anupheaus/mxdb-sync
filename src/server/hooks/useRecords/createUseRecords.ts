import type { AnyObject, DataFilters, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { MXDBCollection, QueryProps, QueryResults } from '../../../common';
import type { ExtensionsType, RecordTypeOfCollection, RemoveDasherized } from '../../../common/models';
import { useCollection } from '../../collections/useCollection';

export type ServerUseRecords<Name extends string, T extends Record, Helpers extends AnyObject = {}> =
  & { [key in Name as `query${Capitalize<RemoveDasherized<Name>>}`]: (props?: QueryProps<T>) => Promise<QueryResults<T>>; }
  & { [key in Name as `getAll${Capitalize<RemoveDasherized<Name>>}`]: () => Promise<T[]>; }
  & { [key in Name as `upsert${Capitalize<RemoveDasherized<Name>>}`]: (records: T | T[]) => Promise<void>; }
  & { [key in Name as `remove${Capitalize<RemoveDasherized<Name>>}`]: (records: T | T[] | string | string[]) => Promise<void>; }
  & { [key in Name as `get${Capitalize<RemoveDasherized<Name>>}`]: (id: string) => Promise<T | undefined>; }
  & { [key in Name as `find${Capitalize<RemoveDasherized<Name>>}`]: (filters: DataFilters<T>) => Promise<T | undefined>; }
  & { [key in Name as `distinct${Capitalize<RemoveDasherized<Name>>}`]: <K extends keyof T>(field: K, props?: { filters?: DataFilters<T> }) => Promise<T[K][]>; }
  & Helpers;

export type ServerUseRecordsQuery<Name extends string, T extends Record> =
  & { [key in Name as RemoveDasherized<Name>]: T[]; }
  & { [key in Name as `total${Capitalize<RemoveDasherized<Name>>}`]: number; };

type HelpersFunction<Name extends string, T extends Record, HelperResults extends AnyObject> =
  (context: ServerUseRecords<Name, T>) => HelperResults;

export interface CreateUseRecordsOptions<
  Name extends string,
  T extends Record,
  HelperResults extends AnyObject,
  Extensions extends ExtensionsType,
> {
  additionalQueryProps?: Omit<QueryProps<T>, 'disable'>;
  helpers?: HelpersFunction<Name, T, HelperResults>;
  extensions?: Extensions;
}

type UseRecordsHook<
  Name extends string,
  T extends Record,
  HelperResults extends AnyObject,
  Extensions extends ExtensionsType,
> = ((() => ServerUseRecords<Name, T, HelperResults>) & {
  query(): Promise<ServerUseRecordsQuery<Name, T>>;
  query(ids: (T | string)[]): Promise<ServerUseRecordsQuery<Name, T>>;
  query(props: QueryProps<T>): Promise<ServerUseRecordsQuery<Name, T>>;
}) & Extensions;

export function createUseRecords<
  Name extends string,
  Collection extends MXDBCollection,
  HelperResults extends AnyObject = {},
  Extensions extends ExtensionsType = {},
>(
  name: Name,
  collection: Collection,
  options?: CreateUseRecordsOptions<Name, RecordTypeOfCollection<Collection>, HelperResults, Extensions>,
) {
  type T = RecordTypeOfCollection<Collection>;
  const pascalName = name.toVariableName('pascal') as Capitalize<RemoveDasherized<Name>>;
  const camelName = name.toVariableName() as RemoveDasherized<Name>;
  const { additionalQueryProps, helpers, extensions } = options ?? {};

  function useRecords(): ServerUseRecords<Name, T, HelperResults> {
    const col = useCollection(collection);

    const baseResult = {
      [`query${pascalName}`]: col.query,
      [`getAll${pascalName}`]: col.getAll,
      [`upsert${pascalName}`]: col.upsert,
      [`remove${pascalName}`]: col.remove,
      [`get${pascalName}`]: col.get,
      [`find${pascalName}`]: col.find,
      [`distinct${pascalName}`]: col.distinct,
    } as ServerUseRecords<Name, T>;

    const helperResults = helpers?.(baseResult);

    return { ...baseResult, ...helperResults } as ServerUseRecords<Name, T, HelperResults>;
  }

  async function useRecordsQuery(): Promise<ServerUseRecordsQuery<Name, T>>;
  async function useRecordsQuery(ids: (T | string)[]): Promise<ServerUseRecordsQuery<Name, T>>;
  async function useRecordsQuery(props: QueryProps<T>): Promise<ServerUseRecordsQuery<Name, T>>;
  async function useRecordsQuery(
    idsOrProps?: (T | string)[] | QueryProps<T>,
  ): Promise<ServerUseRecordsQuery<Name, T>> {
    const col = useCollection(collection);

    let resolvedProps: QueryProps<T>;

    if (idsOrProps == null) {
      resolvedProps = { ...(additionalQueryProps ?? {}) } as QueryProps<T>;
    } else if (Array.isArray(idsOrProps)) {
      const recordIds = idsOrProps.map(item => (is.string(item) ? item : (item as T).id));
      resolvedProps = {
        filters: { id: { $in: recordIds } } as DataFilters<T>,
        ...additionalQueryProps,
      } as QueryProps<T>;
    } else {
      resolvedProps = { ...additionalQueryProps, ...idsOrProps } as QueryProps<T>;
    }

    const { records, total } = await col.query(resolvedProps);

    return {
      [camelName]: records,
      [`total${pascalName}`]: total,
    } as ServerUseRecordsQuery<Name, T>;
  }

  (useRecords as any).query = useRecordsQuery;

  if (is.plainObject(extensions)) {
    Object.entries(extensions).forEach(([key, fn]) => {
      (useRecords as any)[key] = fn;
    });
  }

  return useRecords as UseRecordsHook<Name, T, HelperResults, Extensions>;
}

export type CreateUseRecords<
  Name extends string,
  Collection extends MXDBCollection,
  HelperResults extends AnyObject = {},
  Extensions extends ExtensionsType = {},
> = ReturnType<typeof createUseRecords<Name, Collection, HelperResults, Extensions>>;
