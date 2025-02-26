import bunyan from 'bunyan'
import { v4 as uuidv4 } from 'uuid'
import { Pool } from 'pg'
import type {
  Query, DBConfig, DBClass, TableWithJoin, QueryCondition, QueryOrder, QueryData,
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
    this.clients = []
    const options = {
      connectionString,
      idleTimeoutMillis: this.dbConfig.idleTimeoutMillis ?? 10,
      min: this.dbConfig.minConnection ?? 1,
      max: this.dbConfig.maxConnection ?? 10,
      allowExitOnIdle: this.dbConfig.allowExitOnIdle ?? true,
    }
    this.pool = new Pool(options)
      .on('error', (err: any) => { this.logger.error({ event: 'PGPool - constructor - error', err }) })
      .on('connect', () => { this.logger.info({ event: 'PGPool - constructor - connect' }) })
      .on('acquire', () => { this.logger.info({ event: 'PGPool - constructor - acquire' }) })
      .on('remove', () => { this.logger.info({ event: 'PGPool - constructor - remove' }) })
    this.logger.info({ event: `Pool (${this.dbConfig.endpoint}:${this.dbConfig.port}) is ready` })
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
      return { rows: result, count: result.length || 0, ttl: undefined }
    } catch (err) {
      this.logger.error({ event: 'query', err })
      throw new Error('Invalid SQL query')
    }
  }

  // Validate inputs to not allow SQL injection
  static validateIdentifier = (identifier: string) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)?$|^\*$/.test(identifier)) {
      throw new Error(`Invalid identifier: ${identifier}`)
    }
  }

  static validateComparator = (comparator: string) => {
    if (!/^(=|!=|<>|<|<=|>|>=)$/.test(comparator)) {
      throw new Error(`Invalid comparator: ${comparator}`)
    }
  }

  static validateValue = (value: any) => {
    // check if value is a string, number, or boolean
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error('Invalid value')
    }
  }

  static validateJoinType = (joinType: string) => {
    if (!/^(INNER|LEFT|RIGHT|FULL)$/.test(joinType)) {
      throw new Error(`Invalid join type: ${joinType}`)
    }
  }

  async validateQuery(query: Query): Promise<void> {
    try {
      await this.pool.query(`EXPLAIN ${query.text}`, query.values)
    } catch (err) {
      this.logger.error({ event: 'validateQuery', err })
      throw new Error('Invalid SQL query')
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
    let condition = ''
    if (_conditions && _conditions.array && _conditions.array.length > 0) {
      _conditions.array.forEach((c) => {
        PgClass.validateIdentifier(c.field)
        if (c.comparator) PgClass.validateComparator(c.comparator)
        PgClass.validateValue(c.value)
      })
      condition = ` WHERE ${_conditions.array.map((c) => `${c.field} ${c.comparator || '='} $${values.push(c.value)}`).join(`${_conditions.is_or ? ' OR ' : ' AND '}`)}`
    }
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

  async insert(_table: string, _data: QueryData[]) {
    if (!_table || _table.length < 1 || !_data || _data.length < 1) {
      throw new Error('Invalid query')
    }
    PgClass.validateIdentifier(_table)
    const fieldSet = new Set() // Check for duplicate fields
    _data.forEach(({ field, value }) => {
      PgClass.validateIdentifier(field)
      PgClass.validateValue(value)
      if (fieldSet.has(field)) {
        throw new Error('Duplicate field in data')
      }
      fieldSet.add(field)
    })
    const fieldQuery: string = `INSERT INTO ${_table} (${_data.map(({ field }) => field).join(', ')})`
    const valueQuery: string = `VALUES (${_data.map((_value, i) => `$${i + 1}`).join(', ')})`
    const values: any[] = _data.map(({ value }) => value)
    const query: Query = { text: `${fieldQuery} ${valueQuery} RETURNING *`, values }
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }

  async update(
    _table: string,
    _data: QueryData[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
  ) {
    if (!_table || _table.length < 1 || !_data || _data.length < 1) {
      throw new Error('Invalid query')
    }
    if (!_conditions || !_conditions.array || _conditions.array.length < 1) {
      throw new Error('Invalid conditions')
    }
    PgClass.validateIdentifier(_table)
    const fieldSet = new Set() // Check for duplicate fields
    _data.forEach(({ field, value }) => {
      PgClass.validateIdentifier(field)
      PgClass.validateValue(value)
      if (fieldSet.has(field)) {
        throw new Error('Duplicate field in data')
      }
      fieldSet.add(field)
    })

    const fieldQuery: string = `UPDATE ${_table} SET ${_data.map(({ field }, i) => `${field} = $${i + 1}`).join(', ')}`
    const values: any[] = _data.map(({ value }) => value)
    let condition = ''

    _conditions.array.forEach((c) => {
      PgClass.validateIdentifier(c.field)
      if (c.comparator) PgClass.validateComparator(c.comparator)
      PgClass.validateValue(c.value)
    })
    condition = ` WHERE ${_conditions.array.map((c) => `${c.field} ${c.comparator || '='} $${values.push(c.value)}`).join(`${_conditions.is_or ? ' OR ' : ' AND '}`)}`

    const query: Query = { text: `${fieldQuery}${condition} RETURNING *`, values }
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }

  async upsert(
    _table: string,
    _indexData: string[],
    _data: QueryData[],
  ) {
    if (!_table || _table.length < 1 || !_indexData || _indexData.length < 1
      || !_data || _data.length < 1) {
      throw new Error('Invalid query')
    }
    PgClass.validateIdentifier(_table)
    _indexData.forEach(PgClass.validateIdentifier)
    const fieldSet = new Set() // Check for duplicate fields
    _data.forEach(({ field, value }) => {
      PgClass.validateIdentifier(field)
      PgClass.validateValue(value)
      if (fieldSet.has(field)) {
        throw new Error('Duplicate field in data')
      }
      fieldSet.add(field)
    })
    // Check that all values in _indexData can be found inside the field of the _data array
    _indexData.forEach((indexField) => {
      if (!_data.find(({ field }) => field === indexField)) {
        throw new Error(`Index field ${indexField} not found in data fields`)
      }
    })
    // Check that there are field of the _data array cannot be found in _indexData
    const excludedFields = _data.filter(({ field }) => !_indexData.includes(field))
    if (excludedFields.length < 1) {
      throw new Error('No data fields to update')
    }
    const fieldQuery: string = `INSERT INTO ${_table} (${_data.map(({ field }) => field).join(', ')})`
    const valueQuery: string = `VALUES (${_data.map((_value, i) => `$${i + 1}`).join(', ')})`
    const conflictQuery: string = `ON CONFLICT (${_indexData.join(', ')}) DO UPDATE SET ${excludedFields
      .map(({ field }) => `${field} = EXCLUDED.${field}`)
      .join(', ')}`
    const values: any[] = _data.map(({ value }) => value)
    const query: Query = { text: `${fieldQuery} ${valueQuery} ${conflictQuery} RETURNING *`, values }
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }

  async delete(_table: string, _conditions?: { array: QueryCondition[], is_or: boolean }) {
    if (!_table || _table.length < 1) {
      throw new Error('Invalid query')
    }
    PgClass.validateIdentifier(_table)
    if (!_conditions || !_conditions.array || _conditions.array.length < 1) {
      throw new Error('Invalid conditions')
    }
    let condition = ''
    const values: any[] = []
    _conditions.array.forEach((c) => {
      PgClass.validateIdentifier(c.field)
      if (c.comparator) PgClass.validateComparator(c.comparator)
      PgClass.validateValue(c.value)
    })
    condition = ` WHERE ${_conditions.array.map((c) => `${c.field} ${c.comparator || '='} $${values.push(c.value)}`).join(`${_conditions.is_or ? ' OR ' : ' AND '}`)}`

    const query: Query = { text: `DELETE FROM ${_table}${condition} RETURNING *`, values }
    // Do not validate query for now to save time
    // await this.validateQuery(query)
    return this.query(query, true)
  }
}
