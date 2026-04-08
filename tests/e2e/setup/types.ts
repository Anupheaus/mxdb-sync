/**
 * Barrel for default e2e fixture types and run-log contracts.
 * Prefer importing from `./setup` or this file; split modules are `e2eTestFixture` / `runLogTypes`.
 */
export type { E2eTestMetadata, E2eTestRecord } from './e2eTestFixture';
export { e2eTestCollection } from './e2eTestFixture';

export type { RunLogDetail, RunLogEvent, RunLogger } from './runLogTypes';
