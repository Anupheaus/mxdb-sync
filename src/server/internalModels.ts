import type { Http2Server } from 'http2';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { MXDBDeviceInfo, MXDBUserDetails } from '../common/models';
import type { MXDBCollection } from '../common';
import type { ServerConfig as StartSocketServerConfig } from '@anupheaus/socket-api/server';
import type Koa from 'koa';

export type AnyHttpServer = Http2Server | HttpServer | HttpsServer;

export { Koa };
export interface ServerConfig extends StartSocketServerConfig {
  collections: MXDBCollection[];
  mongoDbUrl: string;
  mongoDbName: string;
  clearDatabase?: boolean;
  shouldSeedCollections?: boolean;
  /** Idle window (ms) before change stream events are dispatched. Default 20. */
  changeStreamDebounceMs?: number;
  /** Called during invite redemption to fetch user details for the given userId. */
  onGetUserDetails(userId: string): Promise<MXDBUserDetails>;
  /** Invite link TTL in milliseconds. Default: 24 hours (86 400 000). */
  inviteLinkTTLMs?: number;
}

export interface ServerInstance {
  app: Koa;
  createInviteLink(userId: string, domain: string): Promise<string>;
  getDevices(userId: string): Promise<MXDBDeviceInfo[]>;
  enableDevice(requestId: string): Promise<void>;
  disableDevice(requestId: string): Promise<void>;
  /** Cleanly close the MongoClient — call from SIGTERM/SIGINT handlers to release in-flight transaction locks. */
  close(): Promise<void>;
}