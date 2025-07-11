import bunyan from 'bunyan'
import { v4 as uuidv4 } from 'uuid'
import { Pool } from 'pg'
import type {
  Query, DBConfig, DBClass, TableWithJoin, QueryCondition, QueryOrder, QueryData,
  QueryResult,
} from './baseClass'

export default class PgClass implements DBClass {
  private dbConfig: DBConfig
  private pool: any
  private clients: { [key: string]: any } = {}
  private logger: any

  constructor(dbConfig: DBConfig) {
    if (!dbConfig || dbConfig.client !== 'pg' || !dbConfig.endpoint || !dbConfig.port || !dbConfig.database || !dbConfig.username || !dbConfig.password) {
      throw new Error('Invalid DB config')
    }
    this.dbConfig = dbConfig
    this.logger = bunyan.createLogger({
      name: 'PgClass',
      streams: [{ stream: process.stderr, level: dbConfig.logLevel as bunyan.LogLevel }],
    })
    const connectionString = `postgres://${dbConfig.username}:${dbConfig.password}@${dbConfig.endpoint}:${dbConfig.port}/${dbConfig.database}`
    const pathname = `${dbConfig.endpoint}:${dbConfig.port}/${dbConfig.database}`

    this.clients = []
    const options = {
      connectionString,
      idleTimeoutMillis: this.dbConfig.idleTimeoutMillis ?? 10,
      min: this.dbConfig.minConnection ?? 1,
      max: this.dbConfig.maxConnection ?? 10,
      allowExitOnIdle: this.dbConfig.allowExitOnIdle ?? true,
    }
    this.pool = new Pool(options)
      .on('error', (err: any) => { this.logger.error({ event: 'PGPool - constructor - error', pathname, err }) })
      .on('connect', () => { this.logger.info({ event: 'PGPool - constructor - connect', connectionCount: this.pool.totalCount, pathname }) })
      .on('acquire', () => { this.logger.info({ event: 'PGPool - constructor - acquire', pathname }) })
      .on('release', () => { this.logger.info({ event: 'PGPool - constructor - release', pathname }) })
      .on('remove', () => { this.logger.info({ event: 'PGPool - constructor - remove', connectionCount: this.pool.totalCount, pathname }) })
    this.logger.info({ event: `Pool (${this.dbConfig.endpoint}:${this.dbConfig.port}) is ready` })
  }

  getConfig(): DBConfig {
    return this.dbConfig
  }

  async connect() {
    try {
      const clientId: string = uuidv4()
      // only used by transaction
      this.clients[clientId] = await this.pool.connect()
    } catch (err) {
      this.logger.error({ event: 'PGPool - connect', err })
      throw new Error('Failed to connect to database')
    }
  }

  async disconnect() {
    try {
      await Promise.all(Object.keys(this.clients).map(async (id) => {
        if (Object.prototype.hasOwnProperty.call(this.clients, id)) {
          await this.clients[id].removeAllListeners()
          await this.clients[id].release()
          delete this.clients[id]
        }
      }))
      await this.pool.end()
    } catch (err) {
      this.logger.error({ event: 'PGPool - disconnect', err })
      throw new Error('Failed to disconnect from database')
    }
  }

  async isconnect() {
    try {
      await this.pool.query('SELECT 1')
      return true
    } catch (err) {
      this.logger.error({ event: 'PGPool - isconnect', err })
      return false
    }
  }

  async query(_query: Query, _isWrite: boolean = false, _getLatest: boolean = false) {
    if (!(await this.isconnect())) {
      await this.pool.connect()
    }
    try {
      const result = await this.pool.query(_query.text, _query.values)
      return { rows: result.rows, count: result.rowCount || 0, ttl: undefined }
    } catch (err) {
      this.logger.error({ event: 'query', err })
      // throw new Error('Invalid SQL query')
      throw err
    }
  }

  async getRawClient(): Promise<any> {
    try {
      const clientId: string = uuidv4()
      this.clients[clientId] = await this.pool.connect()
      return this.clients[clientId]
    } catch (err) {
      this.logger.error({ event: 'PGPool - getRawClient', err })
      throw new Error('Failed to get db client')
    }
  }

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
      this.clients[clientId] = await this.pool.connect()
      client = this.clients[clientId]
      await client.query('BEGIN')
      let previousResult: QueryResult = { rows: [], count: 0, ttl: undefined }
      previousResult = await _callbacks.reduce(async (accPromise, callback) => {
        const acc = await accPromise
        return callback(acc, client)
      }, Promise.resolve(previousResult))
      await client.query('COMMIT')
      return previousResult
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK')
      }
      this.logger.error({ event: 'transaction', err })
      throw new Error('Failed to run transaction')
    } finally {
      if (client) {
        await client.release()
      }
    }
  }

  // Validate inputs to not allow SQL injection
  static validateIdentifier = (identifier: string) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)?( as [a-zA-Z0-9_]+)?$|^\*$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`)
    }
  }

  static validateValue = (value: any) => {
    // check if value is a string, number, boolean, or object
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean'
      && (typeof value !== 'object' || Array.isArray(value))) {
      throw new Error('Invalid value')
    }
  }

  static validateJoinType = (joinType: string) => {
    if (!/^(INNER|LEFT|RIGHT|FULL)$/.test(joinType)) {
      throw new Error(`Invalid join type: ${joinType}`)
    }
  }

  static queryConditionToString = (
    _conditions: { array: QueryCondition[], is_or: boolean },
    valueCount: number = 0,
  ): { condition: string, conditionV: any[] } => {
    const conditionV: any[] = []
    if (_conditions && _conditions.array && _conditions.array.length > 0) {
      const conditionStrict:
        { field: string, comparator: string, value: any }[] = _conditions.array.map((c) => {
          if (Array.isArray(c) && c.length === 3) {
            // example use case: ['field', '=', 'value']
            PgClass.validateIdentifier(c[0])
            if (!/^(=|!=|<>|<|<=|>|>=|LIKE|ILIKE)$/.test(c[1])) {
              throw new Error(`Invalid comparator: ${c[1]}`)
            }
            PgClass.validateValue(c[2])
            return { field: c[0], comparator: c[1], value: c[2] }
          }
          if (Array.isArray(c) && c.length === 2) {
            // example use case: ['field', 'value'], or ['field', 'IS NULL']
            PgClass.validateIdentifier(c[0])
            if (typeof c[1] === 'string'
              && /^(IS|IS NOT) (NULL|TRUE|FALSE|UNKNOWN)$/.test(c[1])) {
              return { field: c[0], comparator: c[1], value: '' }
            }
            PgClass.validateValue(c[1])
            return { field: c[0], comparator: '=', value: c[1] }
          }
          // if c is an object { field: string, comparator: string, value: any }
          if (typeof c === 'object' && typeof c.field === 'string') {
            PgClass.validateIdentifier(c.field)
            if (c.comparator) {
              if (!/^(=|!=|<>|<|<=|>|>=|LIKE|ILIKE)$/.test(c.comparator)) {
                throw new Error(`Invalid comparator: ${c.comparator}`)
              }
            }
            PgClass.validateValue(c.value)
            return { field: c.field, comparator: c.comparator || '=', value: c.value }
          }
          throw new Error(`Invalid condition: ${JSON.stringify(c)}`)
        })
      if (conditionStrict.length > 0) {
        return {
          condition: ` WHERE ${conditionStrict.map((c) => `${c.field} ${c.comparator || '='}${(c.value) ? ` $${conditionV.push(c.value) + valueCount}` : ''}`).join(`${_conditions.is_or ? ' OR ' : ' AND '}`)}`,
          conditionV,
        }
      }
    }
    return { condition: '', conditionV }
  }

  async validateQuery(query: Query): Promise<void> {
    try {
      await this.pool.query(`EXPLAIN ${query.text}`, query.values)
    } catch (err) {
      this.logger.error({ event: 'validateQuery', err })
      // throw new Error('Invalid SQL query')
      throw err
    }
  }

  buildSelectQuery(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number,
  ): Query {
    if (!_table || _table.length < 1 || !_fields || _fields.length < 1) {
      this.logger.error({
        event: 'buildSelectQuery', error: 'Invalid query', table: _table, fields: _fields,
      })
      throw new Error('Invalid query')
    }
    // Validate table names and fields
    _table.forEach((t) => {
      PgClass.validateIdentifier(t.table)
      if (t.name) PgClass.validateIdentifier(t.name)
    })
    if (_table.length > 1) {
      _table.slice(1).forEach((t) => {
        if (!t.on || t.on.length < 1 || !t.join_type) {
          throw new Error('Invalid query: TABLES without JOIN and ON')
        }
        PgClass.validateJoinType(t.join_type)
        t.on.forEach(({ left, right }) => {
          PgClass.validateIdentifier(left)
          PgClass.validateIdentifier(right)
        })
      })
    }

    _fields.forEach(PgClass.validateIdentifier)

    const fieldQuery: string = `SELECT ${_fields.join(', ')} FROM `
    // Write the table and join part of the query
    let tableQuery: string = `${_table[0].table}${_table[0].name ? ` AS ${_table[0].name}` : ''}`
    if (_table.length > 1) {
      tableQuery += _table.slice(1).map((t) => ` ${t.join_type ? `${t.join_type} JOIN` : ''} ${t.table}${t.name ? ` AS ${t.name}` : ''} ON ${t.on ? t.on.map(({ left, right }) => `${left} = ${right}`).join(' AND ') : 'TRUE'}`).join('')
    }
    const values: any[] = []
    const { condition, conditionV } = (_conditions) ? PgClass.queryConditionToString(_conditions) : { condition: '', conditionV: [] }
    values.push(...conditionV)
    let order = ''
    if (_order && _order.length > 0) {
      _order.forEach((o) => PgClass.validateIdentifier(o.field))
      order = ` ORDER BY ${_order.map((o) => `${o.field} ${o.is_asc ? 'ASC' : 'DESC'}`).join(', ')}`
    }
    // Validate limit and offset
    if (_limit !== undefined && (!Number.isInteger(_limit) || _limit < 0)) {
      throw new Error('Invalid limit value')
    }
    if (_offset !== undefined && (!Number.isInteger(_offset) || _offset < 0)) {
      throw new Error('Invalid offset value')
    }
    let limit = ''
    if (_limit) {
      if (!Number.isInteger(_limit) || _limit < 0) { throw new Error('Invalid limit value') }
      limit = ` LIMIT $${values.push(_limit)}`
    }
    let offset = ''
    if (_offset) {
      if (!Number.isInteger(_offset) || _offset < 0) { throw new Error('Invalid offset value') }
      offset = ` OFFSET $${values.push(_offset)}`
    }
    const query: Query = { text: `${fieldQuery}${tableQuery}${condition}${order}${limit}${offset}`, values }
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return query
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

  objectToQueryData(_data: Object): QueryData[] {
    const entries = Object.entries(_data)
    if (!entries || !Array.isArray(entries) || entries.length < 1) {
      this.logger.error({
        event: 'objectToQueryData', error: 'Invalid data', data: _data,
      })
      throw new Error('Invalid query')
    }
    return entries.map(([field, value]) => ({ field, value }))
  }

  buildInsertQuery(_table: string, _data: Object): Query {
    const data = this.objectToQueryData(_data)
    if (!_table || _table.length < 1 || !data || data.length < 1) {
      this.logger.error({
        event: 'buildInsertQuery', error: 'Invalid query', table: _table, data: _data,
      })
      throw new Error('Invalid query')
    }
    PgClass.validateIdentifier(_table)
    const fieldSet = new Set() // Check for duplicate fields
    data.forEach((singleData) => {
      const { field, value } = singleData
      PgClass.validateIdentifier(field)
      PgClass.validateValue(value)
      if (fieldSet.has(field)) {
        throw new Error('Duplicate field in data')
      }
      fieldSet.add(field)
    })
    const fieldQuery: string = `INSERT INTO ${_table} (${data.map(({ field }) => field).join(', ')})`
    const valueQuery: string = `VALUES (${data.map((_value, i) => `$${i + 1}`).join(', ')})`
    const values: any[] = data.map(({ value }) => value)
    const query: Query = { text: `${fieldQuery} ${valueQuery} RETURNING *`, values }
    return query
  }

  async insert(_table: string, _data: Object) {
    const query = this.buildInsertQuery(_table, _data)
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }

  buildUpdateQuery(
    _table: string,
    _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ): Query {
    const data = this.objectToQueryData(_data)
    if (!_table || _table.length < 1 || !data || data.length < 1) {
      this.logger.error({
        event: 'buildUpdateQuery', error: 'Invalid query', table: _table, data: _data, conditions: _conditions,
      })
      throw new Error('Invalid query')
    }
    if (!_conditions || !_conditions.array || _conditions.array.length < 1) {
      this.logger.error({
        event: 'buildUpdateQuery', error: 'Invalid query', table: _table, data: _data, conditions: _conditions,
      })
      throw new Error('Invalid conditions')
    }
    PgClass.validateIdentifier(_table)
    const fieldSet = new Set() // Check for duplicate fields
    data.forEach(({ field, value }) => {
      PgClass.validateIdentifier(field)
      PgClass.validateValue(value)
      if (fieldSet.has(field)) {
        this.logger.error({
          event: 'buildUpdateQuery', error: 'Invalid query', table: _table, data: _data, conditions: _conditions,
        })
        throw new Error('Duplicate field in data')
      }
      fieldSet.add(field)
    })

    const fieldQuery: string = `UPDATE ${_table} SET ${data.map(({ field }, i) => `${field} = $${i + 1}`).join(', ')}`
    const values: any[] = data.map(({ value }) => value)
    const { condition, conditionV } = (_conditions) ? PgClass.queryConditionToString(_conditions, values.length) : { condition: '', conditionV: [] }
    values.push(...conditionV)

    const query: Query = { text: `${fieldQuery}${condition} RETURNING *`, values }
    return query
  }

  async update(
    _table: string,
    _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ) {
    const query = this.buildUpdateQuery(_table, _data, _conditions)
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }

  buildUpsertQuery(_table: string, _indexData: string[], _data: Object): Query {
    const data = this.objectToQueryData(_data)
    if (!_table || _table.length < 1 || !_indexData || _indexData.length < 1
      || !data || data.length < 1) {
      this.logger.error({
        event: 'buildUpsertQuery', error: 'Invalid query', table: _table, data: _data, indexData: _indexData,
      })
      throw new Error('Invalid query')
    }
    PgClass.validateIdentifier(_table)
    _indexData.forEach(PgClass.validateIdentifier)
    const fieldSet = new Set() // Check for duplicate fields
    data.forEach(({ field, value }) => {
      PgClass.validateIdentifier(field)
      PgClass.validateValue(value)
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
    const fieldQuery: string = `INSERT INTO ${_table} (${data.map(({ field }) => field).join(', ')})`
    const valueQuery: string = `VALUES (${data.map((_value, i) => `$${i + 1}`).join(', ')})`
    const conflictQuery: string = `ON CONFLICT (${_indexData.join(', ')}) DO UPDATE SET ${excludedFields
      .map(({ field }) => `${field} = EXCLUDED.${field}`)
      .join(', ')}`
    const values: any[] = data.map(({ value }) => value)
    const query: Query = { text: `${fieldQuery} ${valueQuery} ${conflictQuery} RETURNING *`, values }
    return query
  }

  async upsert(
    _table: string,
    _indexData: string[],
    _data: Object,
  ) {
    const query = this.buildUpsertQuery(_table, _indexData, _data)
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }

  buildDeleteQuery(
    _table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ): Query {
    if (!_table || _table.length < 1) {
      this.logger.error({
        event: 'buildDeleteQuery', error: 'Invalid query', table: _table, conditions: _conditions,
      })
      throw new Error('Invalid query')
    }
    PgClass.validateIdentifier(_table)
    if (!_conditions || !_conditions.array || _conditions.array.length < 1) {
      this.logger.error({
        event: 'buildDeleteQuery', error: 'Invalid query', table: _table, conditions: _conditions,
      })
      throw new Error('Invalid conditions')
    }
    const values: any[] = []
    const { condition, conditionV } = (_conditions) ? PgClass.queryConditionToString(_conditions) : { condition: '', conditionV: [] }
    values.push(...conditionV)

    const query: Query = { text: `DELETE FROM ${_table}${condition} RETURNING *`, values }
    return query
  }

  async delete(_table: string, _conditions?: { array: QueryCondition[], is_or: boolean }) {
    const query = this.buildDeleteQuery(_table, _conditions)
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }
}
