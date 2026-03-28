import type { DataFilters } from '@anupheaus/common';

export interface SqlFragment {
  where: string;   // empty string means "no filter"
  params: unknown[];
}

// ─── Field path → json_extract expression ────────────────────────────────────

function jsonExtract(path: string[]): string {
  return `json_extract(data, '$.${path.join('.')}')`;
}

// ─── Single condition → SQL ───────────────────────────────────────────────────

function operatorToSql(path: string[], operator: string, value: unknown): SqlFragment {
  const field = jsonExtract(path);

  switch (operator) {
    case '$eq':
      return { where: `${field} = ?`, params: [value] };
    case '$ne':
      return { where: `${field} != ?`, params: [value] };
    case '$gt':
      return { where: `${field} > ?`, params: [value] };
    case '$lt':
      return { where: `${field} < ?`, params: [value] };
    case '$gte':
      return { where: `${field} >= ?`, params: [value] };
    case '$lte':
      return { where: `${field} <= ?`, params: [value] };
    case '$like':
      return { where: `${field} LIKE ?`, params: [value] };
    case '$beginsWith':
      return { where: `${field} LIKE ?`, params: [`${value}%`] };
    case '$endsWith':
      return { where: `${field} LIKE ?`, params: [`%${value}`] };
    case '$in': {
      const arr = (Array.isArray(value) ? value : [value]) as unknown[];
      if (arr.length === 0) return { where: '0', params: [] };
      return { where: `${field} IN (${arr.map(() => '?').join(', ')})`, params: arr };
    }
    case '$ni':
    case '$nin': {
      const arr = (Array.isArray(value) ? value : [value]) as unknown[];
      if (arr.length === 0) return { where: '1', params: [] };
      return { where: `${field} NOT IN (${arr.map(() => '?').join(', ')})`, params: arr };
    }
    case '$exists':
      return value
        ? { where: `${field} IS NOT NULL`, params: [] }
        : { where: `${field} IS NULL`, params: [] };
    case '$regex': {
      const pattern = value instanceof RegExp ? value.source : String(value);
      return { where: `${field} REGEXP ?`, params: [pattern] };
    }
    case '$all': {
      // Every value in the list must appear in the JSON array field
      const arr = (Array.isArray(value) ? value : [value]) as unknown[];
      if (arr.length === 0) return { where: '1', params: [] };
      return {
        where: `(SELECT COUNT(*) FROM json_each(${field}) WHERE value IN (${arr.map(() => '?').join(', ')})) = ?`,
        params: [...arr, arr.length],
      };
    }
    case '$size':
      return { where: `json_array_length(${field}) = ?`, params: [value] };
    case '$elemMatch': {
      // Match at least one array element against a sub-filter
      const sub = filtersToSql(value as DataFilters, path.join('.'));
      if (sub.where === '') return { where: '1', params: [] };
      // Re-express using json_each: the sub-filter would normally reference top-level fields
      // but here we need it to reference the element. We use a correlated EXISTS subquery.
      // For simplicity, fall back to a JS post-filter marker — the engine will apply it in-memory.
      // This is noted as a known limitation; proper $elemMatch would require generating
      // json_each subqueries with re-rooted paths.
      return { where: '/* $elemMatch */ 1', params: [] };
    }
    default:
      // Unknown operator — pass-through (match all)
      return { where: '1', params: [] };
  }
}

// ─── Recursive value translator ────────────────────────────────────────────────

function translateValue(path: string[], value: unknown): SqlFragment {
  if (value === undefined) return { where: '', params: [] };
  if (value === null) return { where: `${jsonExtract(path)} IS NULL`, params: [] };

  // Direct array shorthand → $in
  if (Array.isArray(value)) return operatorToSql(path, '$in', value);

  // Primitive / Date / RegExp — direct equality
  if (typeof value !== 'object' || value instanceof RegExp) {
    return operatorToSql(path, '$eq', value);
  }

  // Object: may contain operators and/or nested field paths
  const parts: string[] = [];
  const params: unknown[] = [];

  for (const [key, subValue] of Object.entries(value as Record<string, unknown>)) {
    if (subValue === undefined) continue;
    if (key.startsWith('$')) {
      // Operator key
      const frag = operatorToSql(path, key, subValue);
      if (frag.where) {
        parts.push(frag.where);
        params.push(...frag.params);
      }
    } else {
      // Nested field path
      const frag = translateValue([...path, key], subValue);
      if (frag.where) {
        parts.push(frag.where);
        params.push(...frag.params);
      }
    }
  }

  if (parts.length === 0) return { where: '', params: [] };
  return { where: parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`, params };
}

// ─── Top-level translator ─────────────────────────────────────────────────────

/**
 * Translates a `DataFilters<T>` object into a parameterised SQLite WHERE clause.
 *
 * @param filters  The filter object (may be undefined for "no filter").
 * @param _rootPath  Internal — used by $elemMatch recursion; leave empty externally.
 * @returns `{ where, params }` — `where` is empty string when there is no filter.
 *          All user-supplied values are in `params`; nothing is interpolated into SQL.
 */
export function filtersToSql<T extends object = object>(
  filters: DataFilters<T> | undefined,
  _rootPath?: string,
): SqlFragment {
  if (filters == null) return { where: '', params: [] };

  const entries = Object.entries(filters as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return { where: '', params: [] };

  const parts: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of entries) {
    if (key === '$or') {
      const branches = (value as DataFilters<T>[]).map(f => filtersToSql(f));
      const orParts = branches.map(b => b.where).filter(w => w);
      if (orParts.length > 0) {
        parts.push(orParts.length === 1 ? orParts[0] : `(${orParts.join(' OR ')})`);
        branches.forEach(b => params.push(...b.params));
      }
    } else if (key === '$and') {
      const branches = (value as DataFilters<T>[]).map(f => filtersToSql(f));
      const andParts = branches.map(b => b.where).filter(w => w);
      if (andParts.length > 0) {
        parts.push(andParts.length === 1 ? andParts[0] : `(${andParts.join(' AND ')})`);
        branches.forEach(b => params.push(...b.params));
      }
    } else {
      const frag = translateValue([key], value);
      if (frag.where) {
        parts.push(frag.where);
        params.push(...frag.params);
      }
    }
  }

  if (parts.length === 0) return { where: '', params: [] };
  return {
    where: parts.length === 1 ? parts[0] : parts.join(' AND '),
    params,
  };
}
