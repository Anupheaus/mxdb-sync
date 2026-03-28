import { DataSorts } from '@anupheaus/common';

/**
 * Translates `DataSorts<T>` into a SQLite ORDER BY clause (without the "ORDER BY" keyword).
 * Returns empty string when there are no sorts.
 */
export function sortsToSql<T extends object = object>(sorts: DataSorts<T> | undefined): string {
  const strictSorts = DataSorts.toArray(sorts);
  if (strictSorts.length === 0) return '';

  return strictSorts
    .map(([field, direction]) => {
      const col = `json_extract(data, '$.${String(field)}')`;
      return `${col} ${direction === 'desc' ? 'DESC' : 'ASC'}`;
    })
    .join(', ');
}
