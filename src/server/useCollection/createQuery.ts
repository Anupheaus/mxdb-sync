import type { DataRequest, Record } from '@anupheaus/common';
import type { MongoDocOf, MXDBSyncedCollection } from '../../common';
import { useDb, useLogger } from '../providers';
import type { Filter, Sort } from 'mongodb';

export function createQuery<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { getCollections, fromMongoDocs } = useDb();
  const { logger } = useLogger();
  const { dataCollection } = getCollections(collection);

  return async (request?: DataRequest<RecordType>, getAccurateTotal = false, debug = false) => {
    const [data, total] = await (async () => {
      if (request == null) {
        const innerDocs = fromMongoDocs(await dataCollection.find().toArray());
        return [innerDocs, innerDocs.length];
      } else {
        let filters: Filter<MongoDocOf<RecordType>> = {};
        let sort: Sort | undefined;
        let skip: number | undefined;
        let limit: number | undefined;

        if (request.filters != null) {
          filters = request.filters as any;
          Reflect.walk(filters, ({ name, rename }) => {
            if (name === 'id') rename('_id');
          });
        }
        if (request.pagination != null) {
          skip = request.pagination.offset ?? 0;
          limit = request.pagination.limit;
        }
        if ((request.sorts ?? []).length > 0 || request.pagination != null) {
          const sorts = request.sorts ?? [['id', 'asc']];
          sort = sorts.reduce((acc, [field, direction]) => ({
            ...acc,
            [field === 'id' ? '_id' : field]: direction === 'desc' ? -1 : 1,
          }), {});
        }
        if (debug) logger.debug('Querying database', { filters, sort, skip, limit });
        const innerDocs = fromMongoDocs(await dataCollection.find(filters, { sort, skip, limit }).toArray());
        if (!getAccurateTotal) {
          if (debug) logger.debug('Returning documents', { count: innerDocs.length });
          return [innerDocs, innerDocs.length];
        }
        const totalCount = await dataCollection.countDocuments(filters);
        if (debug) logger.debug('Returning documents', { count: innerDocs.length, total: totalCount });
        return [innerDocs, totalCount];
      }
    })() as [RecordType[], number];

    return {
      data,
      total,
    };
  };
}
