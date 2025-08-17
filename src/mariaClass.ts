import { v4 as uuidv4 } from 'uuid'
import bunyan from 'bunyan'

import type {
  DBConfig, QueryResult, Query,
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
    this.canReturnInUpdate = false // mariadb does not support returning in update query
    logger.info({ event: `Pool (${dbConfig.endpoint}:${dbConfig.port}) is ready` })
  }

  // Extends the connect method as the pool is already connected in the constructor
  async connect() {
    if (this.pool) {
      // it will connect to db itself, just return
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

  // In mariadb, we cannot build a single upsert query like in PostgreSQL, throwing error out
  buildUpsertQuery(_table: string, _indexData: string[], _data: Object): Query {
    if (!this.pool) {
      throw new Error('MariaClass pool is not initialized')
    }
    throw new Error('buildUpsertQuery is not supported in MariaClass, use buildUpsertQueries instead')
  }

  buildUpsertQueries(_table: string, _indexData: string[], _data: Object): Query[] {
    const data = this.objectToQueryData(_data)
    if (!_table || _table.length < 1 || !_indexData || _indexData.length < 1
      || !data || data.length < 1) {
      this.logger.error({
        event: 'buildUpsertQuery', error: 'Invalid query', table: _table, data: _data, indexData: _indexData,
      })
      throw new Error('Invalid query')
    }
    SQLClass.validateIdentifier(_table)
    _indexData.forEach(SQLClass.validateIdentifier)
    const fieldSet = new Set() // Check for duplicate fields
    data.forEach(({ field, value }) => {
      SQLClass.validateIdentifier(field)
      SQLClass.validateValue(value)
      if (fieldSet.has(field)) {
        throw new Error('Duplicate field in data')
      }
      fieldSet.add(field)
    })
    // Check that all values in _indexData can be found inside the field of the _data array
    _indexData.forEach((indexField) => {
      if (!data.find(({ field }) => field === indexField)) {
        throw new Error(`Index field ${indexField} not found in data fields`)
      }
    })
    // Check that there are field of the _data array cannot be found in _indexData
    const excludedFields = data.filter(({ field }) => !_indexData.includes(field))
    if (excludedFields.length < 1) {
      throw new Error('No data fields to update')
    }
    const updateValues: any[] = []
    const insertValues: any[] = []
    const updateQuery = `UPDATE ${_table} SET ${excludedFields
      .map(({ field, value }) => {
        updateValues.push(value)
        return `${field} = ?`
      }).join(', ')}`
      + ` WHERE ${_indexData
        .map((field) => {
          updateValues.push(data.find(({ field: dataField }) => dataField === field)?.value)
          return `${field} = ?`
        }).join(' AND ')};`
    const insertQuery = `INSERT INTO ${_table} (${data.map(({ field }) => field).join(', ')}) `
      + `SELECT ${data.map(({ value }) => {
        insertValues.push(value)
        return '?'
      }).join(', ')} FROM dual `
      + `WHERE NOT EXISTS (SELECT 1 FROM ${_table} WHERE ${_indexData
        .map((field) => {
          insertValues.push(data.find(({ field: dataField }) => dataField === field)?.value)
          return `${field} = ?`
        }).join(' AND ')});`
    // Build the select query
    const selectValues: any[] = []
    const selectQuery = `SELECT * FROM ${_table} WHERE ${_indexData
      .map((field) => {
        selectValues.push(data.find(({ field: dataField }) => dataField === field)?.value)
        return `${field} = ?`
      }).join(' AND ')};`
    const query: Query[] = [
      {
        text: updateQuery,
        values: updateValues,
      },
      {
        text: insertQuery,
        values: insertValues,
      },
      {
        text: selectQuery,
        values: selectValues,
      },
    ]
    return query
  }

  async upsert(
    _table: string,
    _indexData: string[],
    _data: Object,
  ) {
    const queries = this.buildUpsertQueries(_table, _indexData, _data)

    let client: any
    const clientId: string = uuidv4()
    try {
      this.clients[clientId] = await this.pool.getConnection()
      client = this.clients[clientId]
      await client.beginTransaction()
      let previousResult: any = null
      await queries.reduce(async (accPromise, query) => {
        await accPromise // Wait for the previous query to complete
        const queryResult = await client.query(query.text, query.values)
        previousResult = queryResult // Update previousResult with the current query result
      }, Promise.resolve())

      await client.commit()
      return {
        rows: previousResult as any[],
        count: previousResult.length || 0,
        ttl: undefined,
      }
    } catch (err) {
      if (client) {
        await client.rollback()
      }
      this.logger.error({ event: 'upsert transaction', err })
      throw new Error('Failed to run transaction')
    } finally {
      if (client) {
        this.clients[clientId] = undefined
        await client.release()
      }
    }
  }
}
