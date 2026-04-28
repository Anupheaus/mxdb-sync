import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from './collectionsModels';

export type RecordTypeOfCollection<Collection extends MXDBCollection<Record>> =
  Collection extends MXDBCollection<infer RecordType> ? RecordType : never;

export type ExtensionsType = { [key: string]: (...args: any[]) => any };

export type RemoveDasherized<T extends string> =
  T extends `${infer Prefix}-${infer Suffix}`
    ? RemoveDasherized<`${Prefix}${Capitalize<Suffix>}`>
    : T;
