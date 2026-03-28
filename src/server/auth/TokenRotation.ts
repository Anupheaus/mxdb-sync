/**
 * §4.4 — Two-phase token rotation.
 *
 * Token semantics:
 *  `pendingToken`  — the token stored in the client's SQLite DB; used to authenticate.
 *  `currentToken`  — the token from the previous session (kept as a fallback).
 *
 * On every connection:
 *  1. Client authenticates with its stored token (could match `pendingToken` or `currentToken`).
 *  2. Server calls `rotateBeforeAck`:
 *     - Case A (matched `currentToken`): save new token as `pendingToken`.
 *     - Case B (matched `pendingToken`): promote `pendingToken` → `currentToken`, save new `pendingToken`.
 *  3. Server sends new token to client and awaits acknowledgement (`emitWithAck`).
 *  4. On ack, server calls `completeRotation`: `currentToken = newToken`, `pendingToken` cleared.
 *  5. Gate is resolved — stacked action handlers are released.
 */

import { ulid } from 'ulidx';
import type { AuthCollection } from './AuthCollection';
import type { MXDBAuthRecord } from '../../common/models';

export interface RotationResult {
  /** New ULID token to send to the client. */
  newToken: string;
  /** Call this after the client acknowledges receipt of `newToken`. */
  completeRotation(): Promise<void>;
}

export class TokenRotation {
  /**
   * Phase 1: generates a new token and persists the interim state.
   * Must be called before emitting the new token to the client.
   *
   * @param connectionToken - the token the client used to authenticate this session.
   */
  static async rotateBeforeAck(
    authColl: AuthCollection,
    record: MXDBAuthRecord,
    connectionToken: string,
  ): Promise<RotationResult> {
    const newToken = ulid();
    const matchedCurrentToken = record.currentToken === connectionToken;

    if (matchedCurrentToken) {
      // Case A: client connected with the old currentToken (e.g. new pendingToken was lost).
      // Save the new token as pendingToken; leave currentToken intact for now.
      await authColl.update(record.requestId, { pendingToken: newToken });
    } else {
      // Case B: client connected with pendingToken (normal flow).
      // Promote pendingToken → currentToken and save new pendingToken.
      await authColl.update(record.requestId, {
        currentToken: record.pendingToken,
        pendingToken: newToken,
      });
    }

    return {
      newToken,
      completeRotation: () =>
        authColl.update(record.requestId, {
          currentToken: newToken,
          pendingToken: undefined,
        }),
    };
  }
}
