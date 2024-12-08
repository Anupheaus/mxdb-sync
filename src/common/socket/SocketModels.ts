import type { Record } from '@anupheaus/common';

export type SocketPacketRecords = globalThis.Record<string, Record[]>;

export interface SocketIOParserDataPacket {
  entities: SocketPacketRecords;
  payload: string;
}
