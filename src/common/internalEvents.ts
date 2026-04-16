import { defineEvent } from '@anupheaus/socket-api/common';
import type { MXDBTokenRotatedPayload, MXDBUserDetails } from './models';

// ─── Token rotation event (server → specific client) ─────────────────────────
/** Emitted by the server after rotating this client's auth token. */
export const mxdbTokenRotated = defineEvent<MXDBTokenRotatedPayload>('mxdbTokenRotated');

// ─── Device blocked event (server → specific client) ─────────────────────────
/** Emitted by the server when this client's device has been blocked/disabled. */
export const mxdbDeviceBlocked = defineEvent('mxdbDeviceBlocked');

// ─── User authenticated event (server → specific client) ──────────────────────
/**
 * Emitted by the server after validating the device token.
 * Payload is the full user details; `id` carries the userId.
 */
export const mxdbUserAuthenticated = defineEvent<MXDBUserDetails>('mxdbUserAuthenticated');
