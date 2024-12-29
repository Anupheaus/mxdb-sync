import { Context } from '../../contexts';
import type { SocketContextProps } from './SocketContext';

export function useSocket() {
  return Context.get<SocketContextProps>('socket');
}
