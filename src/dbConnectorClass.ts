import type { Query, QueryResult } from './baseClass.ts'
import { DBClass } from './dbClass'

import { CacheClass } from './redisClass'

// export default class DBConnectorClass implements DBClass {
export default class DBConnectorClass {
  private masterDB: DBClass
  private replicaDB: DBClass | undefined
  private redis: CacheClass | undefined
  private msgQueue: any

  constructor(_masterDB: DBClass, _replicaDB?: DBClass, _redis?: any, _msgQueue?: any) {
    this.masterDB = _masterDB
    this.replicaDB = _replicaDB || undefined
    this.redis = _redis || undefined
    this.msgQueue = _msgQueue || undefined
  }

  async connect() {
    await Promise.all(
      [this.masterDB, this.replicaDB, this.redis, this.msgQueue]
        .filter((db) => db)
        .map((db) => db.connect()),
    )
  }

  async disconnect() {
    await Promise.all(
      [this.masterDB, this.replicaDB, this.redis, this.msgQueue]
        .filter((db) => db)
        .map((db) => db.disconnect()),
    )
  }

  async isconnect() {
    return Promise.all(
      [this.masterDB, this.replicaDB, this.redis, this.msgQueue]
        .filter((db) => db)
        .map((db) => db.isconnect()),
    ).then((results) => results.every((result) => result))
  }

  buildSelectQuery(
    _table: { table: string, join_type?: 'INNER' | 'LEFT' | 'RIGHT', name?: string, on?: { left: string, right: string }[] }[],
    _fields: string[],
    _conditions?: { array: { field: string, comparator?: string, value: any }[], is_or: boolean },
    _order?: { field: string, is_asc: boolean }[],
    _limit?: number,
    _offset?: number,
  ): Query {
    return this.masterDB.buildSelectQuery(_table, _fields, _conditions, _order, _limit, _offset)
  }

  async query(_query: Query, _isWrite: boolean = false, _isCache: boolean = true) {
    if (_isWrite) {
      return this.masterDB.query(_query, _isWrite)
    }
    const db = (this.replicaDB) ? this.replicaDB : this.masterDB
    const cacheResult: QueryResult = (this.redis && this.redis.isconnect() && _isCache)
      ? await this.redis.query(_query) : { rows: [], count: 0, ttl: undefined }
    if (!_isCache || !cacheResult || cacheResult.ttl === undefined) {
      // if there is no cache, query to db
      const result: QueryResult = await db.query(_query)
      if (_isCache && result) {
        if (this.redis && this.redis.isconnect()) {
          // save result into cache in background
          this.redis.buildCache(_query, result)
        }
      }
      return result
    }
    if (this.redis && cacheResult.ttl <= (this.redis?.getConfig()?.revalidate || 0)) {
      // revalidate cache in the background
      this.redis.buildCache(_query, await db.query(_query))
    }
    return cacheResult
  }

  /* async select(_query: Query) {
    return this.masterDB.select(_query)
  }

  async insert(_query: Query) {
    return this.masterDB.insert(_query)
  }

  async update(_query: Query) {
    return this.masterDB.update(_query)
  }

  async upsert(_query: Query) {
    return this.masterDB.upsert(_query)
  }

  async delete(_query: Query) {
    return this.masterDB.delete(_query)
  }
  */
}
