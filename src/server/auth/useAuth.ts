/**
 * Per-connection authenticated user context for server-side action/subscription handlers.
 *
 * Population: `startAuthenticatedServer` calls `setAuthState()` during `onClientConnected`
 * after successful token validation. The state is then available in all action/subscription
 * handlers for that connection via `useAuth()`.
 */
import { createAsyncContext, optional } from '@anupheaus/socket-api/server';
import type { MXDBDeviceInfo, MXDBUserDetails } from '../../common/models';
import type { Socket } from 'socket.io';
import { getAuthConfig } from './authConfig';

export interface MutableAuthState {
  user: MXDBUserDetails;
  deviceInfo: MXDBDeviceInfo;
  /** Internal — not exposed via useAuth(). Used by signOut() and onClientDisconnected. */
  socket: Socket;
  /** Set to true before voluntary disconnect so onDisconnected sees reason: 'signedOut'. */
  signedOut: boolean;
}

// ─── WeakMap — used in onClientDisconnected where the async context is gone ──
const connectionStates = new WeakMap<Socket, MutableAuthState>();

// ─── Async context — used inside action/subscription handlers ────────────────
const ctx = createAsyncContext({
  authState: optional<MutableAuthState>(),
});

/** Call once per connection in `onClientConnected` after auth is confirmed. */
export function setAuthState(socket: Socket, state: MutableAuthState): void {
  connectionStates.set(socket, state);
  ctx.setAuthState(state);
}

/** Retrieve auth state by socket — used in `onClientDisconnected`. */
export function getAuthState(socket: Socket): MutableAuthState | undefined {
  return connectionStates.get(socket);
}

/** Remove auth state when the socket is done — called in `onClientDisconnected`. */
export function clearAuthState(socket: Socket): void {
  connectionStates.delete(socket);
}

/**
 * Returns the current user's auth context.
 * Must be called within an authenticated action or subscription handler.
 */
export function useAuth(): {
  user: MXDBUserDetails;
  deviceInfo: MXDBDeviceInfo;
  refresh(): Promise<void>;
  signOut(): void;
} {
  const state = ctx.useAuthState();
  if (state == null) throw new Error('useAuth() called outside of an authenticated request context');

  return {
    get user() { return state.user; },
    get deviceInfo() { return state.deviceInfo; },

    async refresh(): Promise<void> {
      const { onGetUserDetails } = getAuthConfig();
      if (onGetUserDetails == null) return;
      const fresh = await onGetUserDetails(state.user.id);
      state.user = { ...fresh, id: state.user.id };
    },

    signOut(): void {
      state.signedOut = true;
      state.socket.disconnect(true);
    },
  };
}
