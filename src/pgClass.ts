import bunyan from 'bunyan'
import { Pool } from 'pg'

import type {
  DBConfig,
} from './baseClass'

import SQLClass from './dbClass'

export default class PgClass extends SQLClass {
  constructor(dbConfig: DBConfig) {
    if (!dbConfig || dbConfig.client !== 'pg' || !dbConfig.endpoint || !dbConfig.port || !dbConfig.database || !dbConfig.username || !dbConfig.password) {
      throw new Error('Invalid DB config')
    }
    const logger = bunyan.createLogger({
      name: 'PgClass',
      streams: [{ stream: process.stderr, level: dbConfig.logLevel as bunyan.LogLevel }],
    })
    const connectionString = `postgres://${dbConfig.username}:${dbConfig.password}@${dbConfig.endpoint}:${dbConfig.port}/${dbConfig.database}`
    const pathname = `${dbConfig.endpoint}:${dbConfig.port}/${dbConfig.database}`

    const options = {
      connectionString,
      idleTimeoutMillis: dbConfig.idleTimeoutMillis ?? 10,
      min: dbConfig.minConnection ?? 1,
      max: dbConfig.maxConnection ?? 10,
      allowExitOnIdle: dbConfig.allowExitOnIdle ?? true,
    }
    const pool = new Pool(options)
      .on('error', (err: any) => { this.logger.error({ event: 'PGPool - constructor - error', pathname, err }) })
      .on('connect', () => { this.logger.info({ event: 'PGPool - constructor - connect', connectionCount: this.pool.totalCount, pathname }) })
      .on('acquire', () => { this.logger.info({ event: 'PGPool - constructor - acquire', pathname }) })
      .on('release', () => { this.logger.info({ event: 'PGPool - constructor - release', pathname }) })
      .on('remove', () => { this.logger.info({ event: 'PGPool - constructor - remove', connectionCount: this.pool.totalCount, pathname }) })
    super(dbConfig, pool, logger)
    logger.info({ event: `Pool (${dbConfig.endpoint}:${dbConfig.port}) is ready` })
  }
}
