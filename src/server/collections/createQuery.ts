import { type DataRequest, type DataResponse, type Record } from '@anupheaus/common';
import type { MongoDocOf, MXDBSyncedCollection } from '../../common';
import { useDb, useLogger } from '../providers';
import type { Filter } from 'mongodb';

export function createQuery<RecordType extends Record>(collection: MXDBSyncedCollection<RecordType>) {
  const { getCollections, fromMongoDocs, convertSort } = useDb();
  const logger = useLogger();
  const { dataCollection } = getCollections(collection);

  return async (request?: DataRequest<RecordType>, getAccurateTotal = false, debug = false): Promise<DataResponse<RecordType>> => {
    const [data, total, offset, limit] = await (async () => {
      if (request == null) {
        const innerDocs = fromMongoDocs(await dataCollection.find().toArray());
        return [innerDocs, innerDocs.length];
      } else {
        let filters: Filter<MongoDocOf<RecordType>> = {};
        let skip: number | undefined;
        let max: number | undefined;

        if (request.filters != null) {
          filters = request.filters as any;
          Reflect.walk(filters, ({ name, rename }) => {
            if (name === 'id') rename('_id');
          });
        }
        if (request.pagination != null) {
          skip = request.pagination.offset ?? 0;
          max = request.pagination.limit;
        }
        const sort = convertSort(request.sorts);
        if (debug) logger.debug('Querying database', { filters, sort, skip, max });
        const innerDocs = fromMongoDocs(await dataCollection.find(filters, { sort, skip, limit: max }).toArray());
        if (!getAccurateTotal) {
          if (debug) logger.debug('Returning documents', { count: innerDocs.length });
          return [innerDocs, innerDocs.length, skip, max];
        }
        const totalCount = await dataCollection.countDocuments(filters);
        if (debug) logger.debug('Returning documents', { count: innerDocs.length, total: totalCount });
        return [innerDocs, totalCount, skip, max];
      }
    })() as [RecordType[], number, number?, number?];

    return {
      data,
      total,
      offset,
      limit,
    };
  };
}
