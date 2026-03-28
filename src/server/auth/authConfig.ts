/**
 * Module-level auth config set once during `startServer()` and read by auth actions.
 * Follows the same pattern as `getServerConfig()` in socket-api.
 */

import type { MXDBUserDetails } from '../../common/models';

export interface AuthServerConfig {
  /** Called during invite redemption to fetch user details for the `userId`. */
  onGetUserDetails?(userId: string): Promise<MXDBUserDetails>;
  /** Invite link TTL in milliseconds. Default: 24 hours. */
  inviteLinkTTLMs?: number;
}

let _config: AuthServerConfig = {};

export function setAuthConfig(config: AuthServerConfig): void {
  _config = config;
}

export function getAuthConfig(): AuthServerConfig {
  return _config;
}
