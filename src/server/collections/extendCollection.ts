import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from '../../common';
import type { UseCollection } from './useCollection';

export type UseCollectionFn = <RecordType extends Record>(collection: MXDBCollection<RecordType>) => UseCollection<RecordType>;

export interface OnDeletePayload {
  recordIds: string[];
}

export interface OnUpsertPayload<RecordType extends Record = Record> {
  records: RecordType[];
  insertedIds: string[];
  updatedIds: string[];
}

export interface OnClearPayload {
  collectionName: string;
}

export interface CollectionExtensionHooks<RecordType extends Record = Record> {
  onBeforeDelete?(payload: OnDeletePayload, useCollection: UseCollectionFn): Promise<void> | void;
  onAfterDelete?(payload: OnDeletePayload, useCollection: UseCollectionFn): Promise<void> | void;
  onBeforeUpsert?(payload: OnUpsertPayload<RecordType>, useCollection: UseCollectionFn): Promise<void> | void;
  onAfterUpsert?(payload: OnUpsertPayload<RecordType>, useCollection: UseCollectionFn): Promise<void> | void;
  onBeforeClear?(payload: OnClearPayload, useCollection: UseCollectionFn): Promise<void> | void;
  onAfterClear?(payload: OnClearPayload, useCollection: UseCollectionFn): Promise<void> | void;
}

const extensionRegistry = new WeakMap<MXDBCollection, CollectionExtensionHooks>();

export function extendCollection<RecordType extends Record>(
  collection: MXDBCollection<RecordType>,
  hooks: CollectionExtensionHooks<RecordType>,
): void {
  const existing = extensionRegistry.get(collection);
  const merged: CollectionExtensionHooks<RecordType> = {
    ...existing,
    ...hooks,
  };
  extensionRegistry.set(collection, merged);
}

export function getCollectionExtensions<RecordType extends Record>(
  collection: MXDBCollection<RecordType>,
): CollectionExtensionHooks<RecordType> | undefined {
  return extensionRegistry.get(collection) as CollectionExtensionHooks<RecordType> | undefined;
}
