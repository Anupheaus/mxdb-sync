import type { Logger } from '@anupheaus/common';
import type { MXDBCollectionConfig } from '../../../common/models';
import { Db } from './Db';
import '@anupheaus/common';


class Dbs {
  constructor() {
    this.#dbs = new Map<string, Db>();
  }

  #dbs: Map<string, Db>;

  public open(
    name: string,
    collections: MXDBCollectionConfig[],
    encryptionKey?: Uint8Array,
    logger?: Logger,
  ) {
    return this.#dbs.getOrSet(name, () => new Db(name, collections, encryptionKey, logger));
  }

  public async close(name: string) {
    if (!this.#dbs.has(name)) return;
    const db = this.#dbs.get(name);
    if (db != null) await db.close();
    this.#dbs.delete(name);
  }
}

export const dbs = new Dbs();
