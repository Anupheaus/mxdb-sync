// ─── Auth models (shared between client and server) ──────────────────────────

import type { Record } from '@anupheaus/common';

/**
 * User details returned by `onGetUserDetails` on the server and sent to the
 * client to populate the WebAuthn passkey prompt.
 */
export interface MXDBUserDetails extends Record {
  /** Shown in the passkey prompt as the account identifier (e.g. email address). */
  name: string;
  /** Human-readable display name for the prompt (e.g. full name). Defaults to `name`. */
  displayName?: string;
  /** Any additional app-specific fields passed through opaquely to the client. */
  [key: string]: unknown;
}

/** MongoDB `mxdb_authentication` document — one row per device invitation. */
export interface MXDBAuthRecord {
  /** Primary key — ULID generated at invite creation time. */
  requestId: string;
  userId: string;
  deviceDetails?: unknown;
  /**
   * SHA-256 hex digest of the WebAuthn-derived encryption key for this device.
   * Set during registration; used as the connection handshake identifier so
   * the server can disable a device if an invalid token is presented.
   */
  keyHash?: string;
  /** Current valid ULID authentication token. */
  currentToken?: string;
  /**
   * Previous token kept during two-phase rotation grace window.
   * The ULID timestamp encodes when it was issued; the server uses this
   * to determine when the grace period expires.
   */
  pendingToken?: string;
  isEnabled: boolean;
  registrationToken?: string;
  /** ms timestamp of the most recent successful connection. */
  lastConnectedAt?: number;
}

/** Public device info shape returned by `getDevices()`. */
export interface MXDBDeviceInfo {
  requestId: string;
  userId: string;
  deviceDetails?: unknown;
  isEnabled: boolean;
  // createdAt: number;
  lastConnectedAt?: number;
}

export interface MXDBInitialRegistrationResponse {
  registrationToken: string;
  userDetails: MXDBUserDetails;
}

/**
 * Emitted by the client after creating the WebAuthn credential.
 * The server stores keyHash and deviceDetails, generates a token, and replies
 * with AUTH_SUCCESS.
 */
export interface MXDBRegistrationPayload {
  registrationToken: string;
  /** SHA-256 hex digest of the WebAuthn-derived encryption key. */
  keyHash: string;
  /** Collected device fingerprint (user-agent, platform, screen, etc.). */
  deviceDetails: unknown;
}

/** Emitted by the server on the `/{name}/register` namespace on success. */
export interface MXDBInviteSuccess {
  /** Initial ULID authentication token — store in SQLite mxdb_authentication. */
  token: string;
  /** Whatever `onGetUserDetails(userId)` returned — passed through to the client. */
  userDetails: MXDBUserDetails;
}

/** Emitted by the server on the `/{name}/register` namespace on failure. */
export interface MXDBInviteError {
  message: string;
}

/** Emitted by the server after generating a new `pendingToken` for the next session. */
export interface MXDBTokenRotatedPayload {
  /** The new pending token — client stores this in SQLite for the next connection. */
  newToken: string;
}
