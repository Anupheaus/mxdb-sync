import type { SocketAPIAccount, SocketAPIUser } from '@anupheaus/socket-api/common';

export interface MXDBUser extends SocketAPIUser { }

export interface MXDBAccount extends SocketAPIAccount { }

/**
 * MongoDB `mxdb_authentication` document — one row per registered device.
 * Shape matches socket-api's WebAuthnAuthRecord so AuthCollection can implement
 * WebAuthnAuthStore without an adapter layer.
 */
export interface MXDBAuthRecord {
  requestId: string;
  userId: string;
  /** Set by socket-api after WebAuthn registration completes. Empty string on invite records. */
  sessionToken: string;
  /** Deterministic device fingerprint ID computed by socket-api client. Empty on invite records. */
  deviceId: string;
  deviceDetails?: unknown;
  keyHash?: string;
  isEnabled: boolean;
  registrationToken?: string;
  lastConnectedAt?: number;
}

export interface MXDBDeviceInfo {
  requestId: string;
  userId: string;
  deviceDetails?: unknown;
  isEnabled: boolean;
  lastConnectedAt?: number;
}
