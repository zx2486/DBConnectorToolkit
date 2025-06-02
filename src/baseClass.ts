/**
 * Base class for all database, cache and queue classes and input output types
 * Knowing this should be enough to use the whole library
 */
import { UUID } from 'crypto'

/**
 * Query type, defines the structure of a query
 */
export type Query = {
  text: string,
  values: any[]
}

/**
 * QueryResult type, defines the structure of a query result
 * It contains the rows, count and ttl of the query. ttl is defined only if it comes from cache
 */
export type QueryResult = {
  rows: any[]
  count: number
  ttl: number | undefined
}

/**
 * TableWithJoin type, it defines how to input tables values of a query with join support
 * We do not allow plain text join to prevent SQL injection.
 * Example: { table: 'users', name: 'u' }, {
      table: 'user_profiles',
      name: 'up',
      join_type: 'INNER',
      on: [{ left: 'u.id', right: 'up.user_id' }, { left: 'up.is_deleted', right: 'false' }],
    }, {
      table: 'user_entity_relationship',
      name: 'uer',
      join_type: 'LEFT',
      on: [{ left: 'u.id', right: 'uer.user_id' }, { left: 'uer.is_deleted', right: 'true' }],
    }
  * It will be equivalent to users AS u
  * INNER JOIN user_profiles AS up ON u.id = up.user_id AND up.is_deleted = false
  * LEFT JOIN user_entity_relationship AS uer ON u.id = uer.user_id AND uer.is_deleted = true
 */
export type TableWithJoin = {
  table: string,
  join_type?: string,
  name?: string,
  on?: { left: string, right: string }[]
}
/**
 * QueryData type, it defines the structure of a query data.
 * But it is for internal use only, what data input is likely an object.
 * Example: What input to the methods is: {name:'John},
 * what it is internally: { field: 'name', value: 'John' }
 */
export type QueryData = { field: string, value: any }
/**
 * QueryCondition type, it defines the structure of a query condition.
 * Example: { field: 'name', comparator: '=', value: 'John' }
 * Supported comparators: =|!=|<>|<|<=|>|>=|LIKE|ILIKE
 * Supported values: string | number | boolean
 * It also allows shorten syntax for most use cases
 * Example: ['name', '=', 'John'], ['name', 'John'] (two are equivalent)
 * Example: ['post', '!=', 5], ['phone_number', 'IS NULL'], ['user_posts', '>=', 5]
 */
export type QueryCondition = { field: string, comparator?: string, value: any }
  | any[3] | any[2]
// | [string, string, string | number | boolean] | [string, string | number | boolean]
/**
 * QueryOrder type, it defines the structure of a query order.
 * Example: { field: 'name', is_asc: true } ==> ORDER BY name ASC
 */
export type QueryOrder = { field: string, is_asc: boolean }

/**
 * DBConfig, it defines the structure of a database config.
 * client: string, it defines the type of database client, e.g. 'pg', 'mysql'
 * Actual implementation depends on the database type.
 */
export type DBConfig = {
  client: string,
  endpoint: string,
  port: number,
  database: string,
  username: string,
  password: string,
  ssl?: boolean,
  logLevel?: string,
  idleTimeoutMillis?: number,
  minConnection?: number,
  maxConnection?: number,
  allowExitOnIdle?: boolean
}

/**
 * Basic DBClass interface, all objects managing a database client should implement this.
 * By default all methods are async and to be done using pool.
 * To gurantee operation is done by a single connection or doing transactions, get a raw client
 * Supported db methods: select, insert, update, upsert, delete.
 * You may use query directly for other queries.
 * dbConnectorClass, the main class for external use, is an implementation of this interface.
 * Most of the methods are done by masterDB, while select/query can be done by replica or cache.
 */
export interface DBClass {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isconnect(): Promise<boolean>
  query(_query: Query, _isWrite?: boolean, _getLatest?: boolean): Promise<QueryResult>
  buildSelectQuery(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number
  ): Query
  select(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number,
    _getLatest?: boolean
  ): Promise<QueryResult>
  buildInsertQuery(_table: string, _data: Object): Query
  insert(_table: string, _data: Object): Promise<QueryResult>
  buildUpdateQuery(
    _table: string,
    _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean }
  ): Query
  update(_table: string, _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean }
  ): Promise<QueryResult>
  buildUpsertQuery(_table: string, _indexData: string[], _data: Object): Query
  upsert(_table: string, _indexData: string[], _data: Object): Promise<QueryResult>
  buildDeleteQuery(_table: string, _conditions?: { array: QueryCondition[], is_or: boolean }): Query
  delete(_table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean }
  ): Promise<QueryResult>
  getRawClient(): Promise<any>
  /**
   * This method is used to do transaction operations.
   * It means all operations will be altogether or none if any of the operation fails.
   * Each callback has two inputs:
   * _previousResult, the previous query result,
   * _client, the raw client to call query(text,values) directly.
   *
   * The transaction will be auto committed and client be released if all operations succeed.
   * @param _callbacks
   */
  transaction(_callbacks: (
    (_previousResult: QueryResult, _client: any) => Promise<QueryResult>
  )[]): Promise<QueryResult>
}

/**
 * Basic CacheConfig class, it defines the structure of a cache config.
 * client: string, it defines the type of cache client, e.g. 'redis', 'nodecache'
 * Actual implementation depends on the cache type. Times are in seconds.
 * reconnectOnError only works with ioredis, it will determine whether to reconnect on error.
 * pingInterval is the interval to ping the cache server to keep the connection alive.
 * pingInterval, slotsRefreshTimeout, slotsRefreshInterval only works with redis, not ioredis.
 */
export type CacheConfig = {
  client: string,
  url: string,
  additionalNodeList?: string[],
  username?: string,
  password?: string,
  dbIndex?: number,
  cacheHeader?: string,
  cacheTTL?: number,
  revalidate?: number,
  pingInterval?: number,
  connectTimeout?: number,
  keepAlive?: number,
  reconnectStrategy?: (_retries: number) => number,
  reconnectOnError?: (_err: any) => boolean,
  disableOfflineQueue?: boolean,
  tls?: boolean | object,
  checkServerIdentity?: any,
  cluster?: boolean,
  logLevel?: string,
  slotsRefreshTimeout?: number, // timeout on topology refresh, only work with cluster is true
  slotsRefreshInterval?: number, // inteval on topology refresh, only work with cluster is true
}

/**
 * Basic CacheClass interface, all objects connecting to a cache should implement this.
 * One may get data using query, and build cache using buildCache.
 * _query is used as the key to the data
 * getPoolClient provides a raw client for transaction operations.
 */
export interface CacheClass {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isconnect(): Promise<boolean>
  getConfig(): any
  getPoolClient(): Promise<any>
  query(_query: Query): Promise<QueryResult>
  buildCache(_query: Query, _result: QueryResult): Promise<void>
  clearCache(_query: Query): Promise<void>
  clearAllCache(): Promise<void>
}

/**
 * Basic QueueConfig class, it defines the structure of a queue db connection config.
 * client: string, it defines the type of queue client, e.g. 'kafka'
 */
export interface QueueConfig {
  client: string,
  appName: string,
  brokerList: string[],
  groupId?: string, // required for consumer
  ssl?: boolean | {
    rejectUnauthorized: boolean
    ca: string[],
    key: string,
    cert: string
  },
  sasl?: boolean | {
    mechanism: string,
    username?: string,
    password?: string,
    authenticationTimeout?: number,
    reauthenticationThreshold?: number,
    oauthBearerProvider?: () => Promise<any>,
    authorizationIdentity?: string,
    accessKeyId?: string,
    secretAccessKey?: string,
    sessionToken?: string
  },
  connectionTimeout?: number,
  requestTimeout?: number,
  enforceRequestTimeout?: boolean,
  acks?: number,
  msgTimeout?: number,
  compression?: string, // default is none, only gzip is supported without other pacakages
  logLevel?: string,
}

/**
 * QueueMessage type, it defines the structure of a queue message to send.
 */
export type QueueMessage = {
  topic: string,
  message: String,
  key: String,
  headers?: Object,
  ingressionTs?: number
}

/**
 * Basic QueueClass interface, all objects connecting to a queue system should implement this
 * For Kafka, the send function will always return null as direct message reply is not supported
 */
export interface QueueClass {
  connect(_isProducer: boolean): Promise<void>
  disconnect(_isProducer: boolean): Promise<void>
  isconnect(_isProducer: boolean): boolean
  getConfig(): any
  send(_msg: QueueMessage[]): Promise<UUID | null>
  sendCount(): number
  subscribe(
    _topicList: {
      topic: string,
      callback: (_msg: QueueMessage) => Promise<void>
    }[],
    _fromBeginning?: boolean
  ): Promise<void>
  receiveCount(): number
}
