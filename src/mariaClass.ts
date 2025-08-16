import { v4 as uuidv4 } from 'uuid'
import bunyan from 'bunyan'

import type {
  DBConfig, QueryResult,
} from './baseClass'

import SQLClass from './dbClass'

const mariadb = require('mariadb')

export default class MariaClass extends SQLClass {
  constructor(dbConfig: DBConfig) {
    if (!dbConfig || dbConfig.client !== 'mariadb' || !dbConfig.endpoint || !dbConfig.port || !dbConfig.database || !dbConfig.username || !dbConfig.password) {
      throw new Error('Invalid DB config')
    }
    const logger = bunyan.createLogger({
      name: 'MariaClass',
      streams: [{ stream: process.stderr, level: dbConfig.logLevel as bunyan.LogLevel }],
    })

    const host = dbConfig.endpoint
    const connectionLimit = dbConfig.maxConnection ?? 10
    const options = {
      host,
      port: dbConfig.port,
      user: dbConfig.username,
      password: dbConfig.password,
      database: dbConfig.database,
      connectionLimit,
      ssl: dbConfig.ssl ?? false,
      idleTimeout: dbConfig.idleTimeoutMillis ? dbConfig.idleTimeoutMillis / 1000 : 10,
      minimumIdle: dbConfig.minConnection ?? connectionLimit,
      // trace: true,
    }
    const pool = mariadb.createPool(options)
      .on('error', (err: any) => { this.logger.error({ event: 'MariaClass Pool - constructor - error', host, err }) })
      .on('connection', () => { this.logger.info({ event: 'MariaClass Pool - constructor - connect', connectionCount: this.pool.totalConnections(), host }) })
      .on('acquire', (connection: any) => { this.logger.info({ event: 'MariaClass Pool - constructor - acquire', threadId: connection.threadId, host }) })
      .on('release', (connection: any) => { this.logger.info({ event: 'MariaClass Pool - constructor - release', threadId: connection.threadId, host }) })

    super(dbConfig, pool, logger)
    this.usingQuestionMarkInQuery = true // mariadb uses ? as placeholder in query
    logger.info({ event: `Pool (${dbConfig.endpoint}:${dbConfig.port}) is ready` })
  }

  // Extends the connect method as the pool is already connected in the constructor
  async connect() {
    if (this.pool && this.pool.totalConnections() > 0) {
      return
    }
    throw new Error('Failed to connect to database')
  }

  // Extends the getRawClient method as it is connection in mariadb
  async getRawClient(): Promise<any> {
    try {
      const clientId: string = uuidv4()
      this.clients[clientId] = await this.pool.getConnection()
      return this.clients[clientId]
    } catch (err) {
      this.logger.error({ event: 'MariaClass Pool - getRawClient', err })
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
    let client: any
    try {
      const clientId: string = uuidv4()
      this.clients[clientId] = await this.pool.getConnection()
      client = this.clients[clientId]
      await client.beginTransaction()
      let previousResult: QueryResult = { rows: [], count: 0, ttl: undefined }
      previousResult = await _callbacks.reduce(async (accPromise, callback) => {
        const acc = await accPromise
        return callback(acc, client)
      }, Promise.resolve(previousResult))
      await client.commit()
      return previousResult
    } catch (err) {
      if (client) {
        await client.rollback()
      }
      this.logger.error({ event: 'transaction', err })
      throw new Error('Failed to run transaction')
    } finally {
      if (client) {
        await client.release()
      }
    }
  }
}
