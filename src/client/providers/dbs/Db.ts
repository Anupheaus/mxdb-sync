import { InternalError, type Logger, type Record } from '@anupheaus/common';
import { DbCollection } from './DbCollection';
import type { MXDBCollectionConfig } from '../../../common/models';
import { SqliteWorkerClient } from '../../db-worker/SqliteWorkerClient';
import { buildTableDDL } from '../../db-worker/buildTableDDL';

/** Internal auth table DDL — not part of user-defined collections. */
const AUTH_TABLE_DDL = `CREATE TABLE IF NOT EXISTS mxdb_authentication (
  id      TEXT PRIMARY KEY,
  token   TEXT NOT NULL,
  keyHash TEXT NOT NULL DEFAULT ''
)`;

export class Db {
  constructor(
    name: string,
    collections: MXDBCollectionConfig[],
    encryptionKey?: Uint8Array,
    auditorLogger?: Logger,
  ) {
    this.#name = name;
    this.#worker = new SqliteWorkerClient({ encryptionKey });
    // Open the database and ensure all tables exist, then construct collections
    this.#ready = this.#openDb(collections);
    this.#collections = new Map(
      collections.map(config => [
        config.name,
        new DbCollection(this.#worker, this.#ready, config, auditorLogger),
      ]),
    );
    // §4.9: Reload the affected collection whenever another tab writes to it
    this.#worker.setOnExternalChange(collectionName => {
      this.#collections.get(collectionName)?.reloadFromWorker();
    });
  }

  #name: string;
  #worker: SqliteWorkerClient;
  #ready: Promise<void>;
  #collections: Map<string, DbCollection>;

  public get name() { return this.#name; }

  public use<RecordType extends Record>(collectionName: string): DbCollection<RecordType> {
    const collection = this.#collections.get(collectionName) as DbCollection<RecordType> | undefined;
    if (collection == null) throw new InternalError(`Collection "${collectionName}" not found`);
    return collection;
  }

  public async hasPendingAudits(): Promise<boolean> {
    for (const collection of this.#collections.values()) {
      if (await collection.hasPendingAudits()) return true;
    }
    return false;
  }

  public async close(): Promise<void> {
    await this.#worker.close();
  }

  // ─── §4.4 Auth token persistence (internal mxdb_authentication table) ───────

  /** Read the stored auth credentials, or undefined if not yet stored. */
  public async readAuth(): Promise<{ token: string; keyHash: string } | undefined> {
    await this.#ready;
    const rows = await this.#worker.query<{ token: string; keyHash: string }>(
      'SELECT token, keyHash FROM mxdb_authentication WHERE id = \'singleton\' LIMIT 1',
    );
    return rows[0];
  }

  /** Persist auth credentials (replaces any existing ones). */
  public async writeAuth(token: string, keyHash: string): Promise<void> {
    await this.#ready;
    await this.#worker.exec(
      'INSERT OR REPLACE INTO mxdb_authentication(id, token, keyHash) VALUES (\'singleton\', ?, ?)',
      [token, keyHash],
    );
  }

  /** Remove the stored auth credentials (e.g. on sign-out). */
  public async clearAuth(): Promise<void> {
    await this.#ready;
    await this.#worker.exec('DELETE FROM mxdb_authentication WHERE id = \'singleton\'');
  }

  async #openDb(collections: MXDBCollectionConfig[]): Promise<void> {
    const statements: string[] = [
      AUTH_TABLE_DDL, // always create the internal auth table first
    ];
    for (const config of collections) {
      const isAudited = config.disableAudit !== true;
      statements.push(...buildTableDDL(config.name, config.indexes ?? [], isAudited));
    }
    await this.#worker.open(this.#name, statements);
  }
}
