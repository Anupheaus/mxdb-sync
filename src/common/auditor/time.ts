import { monotonicFactory } from 'ulidx';

let clockDriftMs = 0;
let monoUlid = monotonicFactory();

/** Update the client-server clock drift. Call this when a new auth token (ULID) arrives from server. */
export function setClockDrift(drift: number) {
  clockDriftMs = drift;
  monoUlid = monotonicFactory();
}

export function generateUlid(): string {
  return monoUlid(Date.now() - clockDriftMs);
}

