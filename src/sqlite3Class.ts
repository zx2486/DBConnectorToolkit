import bunyan from 'bunyan'

import type {
  DBConfig, QueryResult,
} from './baseClass'

import SQLClass from './dbClass'

const sqlite3 = require('sqlite3')

export default class SQLite3Class extends SQLClass {
  constructor(dbConfig: DBConfig) {
    if (!dbConfig || dbConfig.client !== 'sqlite3' || !dbConfig.endpoint) {
      throw new Error('Invalid DB config')
    }
    const logger = bunyan.createLogger({
      name: 'SQLite3Class',
      streams: [{ stream: process.stderr, level: dbConfig.logLevel as bunyan.LogLevel }],
    })

    const db = new sqlite3.Database(dbConfig.endpoint)
    // Override the pool query method to match the expected interface
    db.query = (text: string, values: any[]) => new Promise((resolve, reject) => {
      db.all(text, values, (err: any, rows: any[]) => {
        if (err) {
          return reject(err)
        }
        return resolve(rows)
      })
    })
    super(dbConfig, db, logger)
    this.usingQuestionMarkInQuery = true // sqlite3 uses ? as placeholder in query
    this.canReturnInUpdate = true // sqlite3 does support returning in update query
    logger.info({ event: `SQLite3 (${dbConfig.endpoint}) is ready` })
  }

  // Extends the connect method as the pool is already connected in the constructor
  async connect() {
    if (this.pool) {
      // it will connect to db itself, just return
      return
    }
    throw new Error('Failed to connect to database')
  }

  async disconnect() {
    if (this.pool) {
      this.pool.close((err: any) => {
        if (err) {
          this.logger.error({ event: 'SQLite3 - disconnect', err })
        } else {
          this.logger.info({ event: 'SQLite3 - disconnected' })
        }
      })
      this.pool = undefined
    }
  }

  // Extends the getRawClient method as it is connection in mariadb
  async getRawClient(): Promise<any> {
    try {
      return this.pool // There is no pool in sqlite3
    } catch (err) {
      this.logger.error({ event: 'SQLite3 - getRawClient', err })
      throw new Error('Failed to get db client')
    }
  }

  // Extends the transaction method to use mariadb pool
  async transaction(_callbacks: (
    (_previousResult: QueryResult, _client: any) => Promise<QueryResult>
  )[]): Promise<QueryResult> {
    if (!_callbacks || !Array.isArray(_callbacks) || _callbacks.length < 1) {
      this.logger.error({ event: 'transaction', error: 'Invalid callbacks' })
      throw new Error('Invalid transaction callbacks')
    }
    // just use the db client to run the queries
    try {
      let previousResult: QueryResult = { rows: [], count: 0, ttl: undefined }
      previousResult = await _callbacks.reduce(async (accPromise, callback) => {
        const acc = await accPromise
        return callback(acc, this.pool)
      }, Promise.resolve(previousResult))
      return previousResult
    } catch (err) {
      this.logger.error({ event: 'transaction', err })
      throw new Error('Failed to run transaction')
    } finally {
      // No need to release the client in sqlite3
    }
  }
}
