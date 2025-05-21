import type {
  Query, QueryResult, DBClass, TableWithJoin, QueryCondition, QueryOrder, CacheClass,
} from './baseClass'

export default class DBConnectorClass implements DBClass {
  // export default class DBConnectorClass {
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

  async getRawClient() {
    return this.masterDB.getRawClient()
  }

  async transaction(_callbacks: (
    (_previousResult: QueryResult, _client: any) => Promise<QueryResult>
  )[]): Promise<QueryResult> {
    return this.masterDB.transaction(_callbacks)
  }

  buildSelectQuery(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number,
  ): Query {
    return this.masterDB.buildSelectQuery(_table, _fields, _conditions, _order, _limit, _offset)
  }

  buildInsertQuery(_table: string, _data: Object): Query {
    return this.masterDB.buildInsertQuery(_table, _data)
  }

  buildUpdateQuery(
    _table: string,
    _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ): Query {
    return this.masterDB.buildUpdateQuery(_table, _data, _conditions)
  }

  buildUpsertQuery(_table: string, _indexData: string[], _data: Object): Query {
    return this.masterDB.buildUpsertQuery(_table, _indexData, _data)
  }

  buildDeleteQuery(
    _table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ): Query {
    return this.masterDB.buildDeleteQuery(_table, _conditions)
  }

  /**
   * Run a query to the database, reading from cache if available
   * @param _query
   * @param _isWrite, if true, always query to master db as it is a write operation,
   * query will go to replica if this is false and replica db is available
   * @param _getLatest, if true, always query to db (slave, master if slave is undefined)
   * and will not create/update cache.
   * @returns result of the query
   */
  async query(_query: Query, _isWrite: boolean = false, _getLatest: boolean = false) {
    if (_isWrite) {
      return this.masterDB.query(_query, _isWrite)
    }
    // All read should be done from replica if available
    const db = (this.replicaDB) ? this.replicaDB : this.masterDB
    const cacheResult: QueryResult | undefined = (
      this.redis && await this.redis.isconnect() && !_getLatest
    ) ? await this.redis.query(_query) : undefined
    if (_getLatest || !cacheResult || cacheResult?.ttl === undefined) {
      // if there is no cache, query to db
      const result: QueryResult = await db.query(_query)
      if (!_getLatest && result) {
        if (this.redis && await this.redis.isconnect()) {
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

  async select(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number,
    _getLatest?: boolean,
  ) {
    const query = this.buildSelectQuery(_table, _fields, _conditions, _order, _limit, _offset)
    return this.query(query, false, _getLatest)
  }

  async insert(_table: string, _data: Object) {
    return this.masterDB.insert(_table, _data)
  }

  async update(
    _table: string,
    _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ) {
    return this.masterDB.update(_table, _data, _conditions)
  }

  async upsert(_table: string, _indexData: string[], _data: Object) {
    return this.masterDB.upsert(_table, _indexData, _data)
  }

  async delete(
    _table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ) {
    return this.masterDB.delete(_table, _conditions)
  }

  async buildCache(_query: Query): Promise<void> {
    if (
      this.redis && await this.redis.isconnect()
      && this.masterDB && await this.masterDB.isconnect()
    ) {
      const result = await this.masterDB.query(_query, false, true)
      await this.redis.buildCache(_query, result)
    }
  }
}
