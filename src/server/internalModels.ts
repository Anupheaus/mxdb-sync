import type { Http2Server } from 'http2';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { MXDBAccount, MXDBDeviceInfo, MXDBUser } from '../common/models';
import type { MXDBCollection } from '../common';
import type { ServerConfig as StartSocketServerConfig } from '@anupheaus/socket-api/server';
import type { CreateInviteOptions } from '@anupheaus/socket-api/server';
import type { InviteDetails } from '@anupheaus/socket-api/common';
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
  /** WebAuthn relying party ID — the domain name registered devices will authenticate against
   *  (e.g. `'vision.lintex.com'`). Defaults to `'localhost'` for local development. */
  rpId?: string;
  onGetUserDetails?(userId: string): Promise<MXDBUser>;
  onGetAccountDetails?(accountId: string): Promise<MXDBAccount | undefined>;
  /**
   * Optional — return the full WebAuthn invite details for the given (userId, accountId) pair.
   * When provided, this takes precedence over `onGetUserDetails` for invite details.
   * Use this to supply account-specific display names and the correct user handle.
   * If omitted, invite details are derived from `onGetUserDetails` with a computed userHandle.
   */
  onGetInviteDetails?(userId: string, accountId?: string): Promise<InviteDetails>;
  onConnected?(ctx: { user: MXDBUser; account?: MXDBAccount }): PromiseMaybe<void>;
  onDisconnected?(ctx: { user: MXDBUser; account?: MXDBAccount; reason: 'signedOut' | 'connectionLost' }): PromiseMaybe<void>;
}

export interface ServerInstance {
  app: Koa;
  createInvite(options: CreateInviteOptions): Promise<string>;
  getDevices(userId: string): Promise<MXDBDeviceInfo[]>;
  enableDevice(requestId: string): Promise<void>;
  disableDevice(requestId: string): Promise<void>;
  close(): Promise<void>;
}
