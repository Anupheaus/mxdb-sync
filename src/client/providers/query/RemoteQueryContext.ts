import { createContext } from 'react';
import type { RemoteQueryRegisterQueryProps } from './useRemoteQuery';
import type { Record } from '@anupheaus/common';

export interface RemoteQueryExtendedRegisterQueryProps<RecordType extends Record> extends Omit<RemoteQueryRegisterQueryProps<RecordType>, 'disable'> {
  dataUpsert(records: RecordType[]): Promise<void>;
  upsertFromQuery(records: RecordType[]): Promise<RecordType[]>;
  hookId: string;
}

export interface RemoteQueryContextProps {
  isValid: boolean;
  registerQuery<RecordType extends Record>(props: RemoteQueryExtendedRegisterQueryProps<RecordType>): Promise<void>;
  unregisterQuery(hookId: string): Promise<void>;
}

export const RemoteQueryContext = createContext<RemoteQueryContextProps>({
  isValid: false,
  registerQuery: () => Promise.resolve(),
  unregisterQuery: () => Promise.resolve(),
});