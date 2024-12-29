import type { MXDBEvent } from '../../common';
import { useClient } from '../providers';

export function useEvent<T>(event: MXDBEvent<T>) {
  const { client } = useClient();
  return (payload: T) => client.emitWithAck(event.name, payload);
}