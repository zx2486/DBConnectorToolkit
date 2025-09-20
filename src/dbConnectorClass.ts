import bunyan from 'bunyan'
import * as crypto from 'crypto'
import type {
  Query, QueryResult, DBClass, TableWithJoin, QueryCondition, QueryOrder, CacheClass, QueueClass,
} from './baseClass'

export default class DBConnectorClass implements DBClass {
  // export default class DBConnectorClass {
  private masterDB: DBClass
  private replicaDB: DBClass[] | []
  private redis: CacheClass | undefined
  private msgQueue: QueueClass | undefined
  private logger: bunyan

  constructor(
    _masterDB: DBClass,
    _replicaDB?: DBClass[],
    _redis?: CacheClass,
    _msgQueue?: QueueClass,
  ) {
    this.masterDB = _masterDB
    this.replicaDB = _replicaDB || []
    this.redis = _redis || undefined
    this.msgQueue = _msgQueue || undefined
    this.logger = bunyan.createLogger({
      name: 'DBConnectorClass',
      streams: [{
        stream: process.stderr,
        level: _masterDB.getConfig()?.logLevel as bunyan.LogLevel,
      }],
    })
  }

  async connect() {
    await Promise.all(
      [this.masterDB, ...this.replicaDB, this.redis]
        .filter((db) => db)
        .map((db) => db?.connect()),
    )
    if (this.msgQueue) {
      await this.msgQueue.connect(true)
    }
  }

  async disconnect() {
    await Promise.all(
      [this.masterDB, ...this.replicaDB, this.redis]
        .filter((db) => db)
        .map((db) => db?.disconnect()),
    )
    if (this.msgQueue) {
      await this.msgQueue.disconnect(true)
    }
  }

  async isconnect() {
    return Promise.all(
      [this.masterDB, ...this.replicaDB, this.redis]
        .filter((db) => db)
        .map((db) => db?.isconnect()),
    ).then((results) => results.every((result) => result))
      .then((result) => {
        if (this.msgQueue) {
          return result && this.msgQueue.isconnect(true)
        }
        return result
      })
  }

  getConfig() {
    return this.masterDB.getConfig()
  }

  async getRawClient() {
    return this.masterDB.getRawClient()
  }

  async transaction(_callbacks: (
    (_previousResult: QueryResult, _client: any) => Promise<QueryResult>
  )[]): Promise<QueryResult> {
    if (this.msgQueue && this.msgQueue.isconnect(true)) {
      // TODO: how to support transaction with message queue?
      throw new Error('Cannot do transaction while message queue is connected')
    }
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
   * @param _isWrite, if true, always query to master db and ignore _getLatest.
   * @param _getLatest, if true, always query to db (replica, master if replica is undefined)
   * and will not create/update/read cache.
   * If both _isWrite and _getLatest are false, it will read from cache if available, db if not.
   * It will also revalidate cache in background if needed
   * @returns result of the query
   */
  async query(_query: Query, _isWrite: boolean = false, _getLatest: boolean = false) {
    if (_isWrite) {
      if (this.msgQueue && this.msgQueue.isconnect(true)) {
        const dbTopic = this.msgQueue.getDBTopic()
        if (dbTopic) {
          // if message queue is connected, send query to message queue
          const result = await this.msgQueue.send([{
            topic: dbTopic,
            message: JSON.stringify(_query),
            key: crypto.randomUUID(),
          }]).catch((err) => {
            this.logger?.error('Error sending query to message queue:', err)
            return null
          })
          if (result) {
            // return the UUID of the message sent
            return {
              rows: [{ uuid: result }],
              count: 1,
              ttl: undefined,
            }
          }
        }
      }
      return this.masterDB.query(_query, _isWrite)
    }
    // All read should be done from replica if available
    const dbQuery = async (_inquery: Query): Promise<QueryResult> => {
      if (this.replicaDB && this.replicaDB.length > 0) {
        try {
          return this.replicaDB[Math.floor(Math.random() * this.replicaDB.length)].query(_inquery)
        } catch (err) {
          // if any of replica db failed, fallback to master db
        }
      }
      return this.masterDB.query(_inquery)
    }
    const cacheResult: QueryResult | undefined = (
      !_getLatest && this.redis && await this.redis.isconnect()
    ) ? await this.redis.query(_query) : undefined
    if (_getLatest || !cacheResult || cacheResult?.ttl === undefined) {
      // if there is no cache, query to db
      const result: QueryResult = await dbQuery(_query)
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
      dbQuery(_query).then(async (result) => {
        if (this.redis && await this.redis.isconnect()) {
          this.redis.buildCache(_query, result)
        }
      })
      // this.redis.buildCache(_query, await db.query(_query))
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
    // return this.masterDB.insert(_table, _data)
    const query = this.buildInsertQuery(_table, _data)
    return this.query(query, true)
  }

  async update(
    _table: string,
    _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ) {
    // return this.masterDB.update(_table, _data, _conditions)
    const query = this.buildUpdateQuery(_table, _data, _conditions)
    return this.query(query, true)
  }

  async upsert(_table: string, _indexData: string[], _data: Object) {
    // return this.masterDB.upsert(_table, _indexData, _data)
    try {
      // if the masterDB supports upsert in one statement, use it
      const query = this.buildUpsertQuery(_table, _indexData, _data)
      return this.query(query, true)
    } catch (err) {
      // if the masterDB does not support upsert in one statement,
      // use multiple insert/update queries
      if (this.msgQueue && this.msgQueue.isconnect(true)) {
        // TODO: how to support transaction with message queue?
        throw new Error('Cannot do transaction (from upsert) while message queue is connected')
      }
      return this.masterDB.upsert(_table, _indexData, _data)
    }
  }

  async delete(
    _table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ) {
    // return this.masterDB.delete(_table, _conditions)
    const query = this.buildDeleteQuery(_table, _conditions)
    return this.query(query, true)
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
