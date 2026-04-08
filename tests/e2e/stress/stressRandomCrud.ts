import type { E2eTestMetadata, E2eTestRecord } from '../setup/types';
import { CRUD_GAP_MAX_MS, CRUD_GAP_MIN_MS } from './config';

const rand = () => Math.random().toString(36).slice(2, 9);

export function randomCrudGap(): Promise<void> {
  const ms = CRUD_GAP_MIN_MS + Math.random() * (CRUD_GAP_MAX_MS - CRUD_GAP_MIN_MS);
  return new Promise(r => setTimeout(r, ms));
}

export function createNewRecord(clientId: string): E2eTestRecord {
  const now = Date.now();
  return {
    id: Math.uniqueId(),
    clientId,
    testDate: now,
    value: `v-${now}-${rand()}`,
  };
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function randomMetadata(): E2eTestMetadata {
  return {
    count: Math.floor(Math.random() * 1000),
    tag: Math.random() < 0.35 ? null : `tag-${rand()}`,
  };
}

function randomTags(): string[] | null {
  if (Math.random() < 0.2) return null;
  const n = 1 + Math.floor(Math.random() * 4);
  return Array.from({ length: n }, () => `t-${rand()}`);
}

export function mutateRecordRandom(base: E2eTestRecord, writerClientId: string): E2eTestRecord {
  const now = Date.now();
  const pool = shuffle(['value', 'name', 'metadata', 'tags'] as const);
  const numFields = 1 + Math.floor(Math.random() * pool.length);
  const chosen = new Set(pool.slice(0, numFields));
  const next: E2eTestRecord = { ...base, id: base.id, clientId: writerClientId, testDate: now };
  if (chosen.has('value')) next.value = `v-${now}-${rand()}`;
  if (chosen.has('name')) {
    const r = Math.random();
    if (r < 0.3) next.name = null;
    else next.name = `n-${rand()}`;
  }
  if (chosen.has('metadata')) next.metadata = randomMetadata();
  if (chosen.has('tags')) next.tags = randomTags();
  return next;
}
