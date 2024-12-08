import { Context } from '../../contexts';
import { SocketContextProps } from './SocketContext';

export function useSocket() {
  return Context.get<SocketContextProps>('socket');
}
