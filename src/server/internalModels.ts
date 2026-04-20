import type { Http2Server } from 'http2';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { MXDBDeviceInfo, MXDBUserDetails } from '../common/models';
import type { MXDBCollection } from '../common';
import type { ServerConfig as StartSocketServerConfig } from '@anupheaus/socket-api/server';
import type { PromiseMaybe } from '@anupheaus/common';
import type Koa from 'koa';

export type AnyHttpServer = Http2Server | HttpServer | HttpsServer;

export { Koa };
export interface ServerConfig extends StartSocketServerConfig {
  collections: MXDBCollection[];
  mongoDbUrl: string;
  mongoDbName: string;
  clearDatabase?: boolean;
  shouldSeedCollections?: boolean;
  changeStreamDebounceMs?: number;
  onGetUserDetails?(userId: string): Promise<MXDBUserDetails>;
  onConnected?(ctx: { user: MXDBUserDetails }): PromiseMaybe<void>;
  onDisconnected?(ctx: { user: MXDBUserDetails; reason: 'signedOut' | 'connectionLost' }): PromiseMaybe<void>;
}

export interface ServerInstance {
  app: Koa;
  createInvite(userId: string, baseUrl: string): Promise<string>;
  getDevices(userId: string): Promise<MXDBDeviceInfo[]>;
  enableDevice(requestId: string): Promise<void>;
  disableDevice(requestId: string): Promise<void>;
  close(): Promise<void>;
}
