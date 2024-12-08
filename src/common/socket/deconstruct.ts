import { is, to } from '@anupheaus/common';
import type { SocketIOParserDataPacket } from './SocketModels';

export function deconstruct(data: unknown): SocketIOParserDataPacket | unknown {
  return is.plainObject(data) ? to.serialise(data) : data;
}
