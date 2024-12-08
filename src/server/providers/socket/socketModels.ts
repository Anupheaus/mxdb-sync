import type { SocketClientConnectedProps } from './SocketContext';

type SocketOn = SocketClientConnectedProps['on'];
type SocketEmit = SocketClientConnectedProps['emit'];

export { SocketOn, SocketEmit };