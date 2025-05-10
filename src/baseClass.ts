import { UUID } from 'crypto'

// This file contains the types for the base class, for external use knowing this should be enough
export type Query = {
  text: string,
  values: any[]
}

export type QueryResult = {
  rows: any[]
  count: number
  ttl: number | undefined
}

export type TableWithJoin = {
  table: string,
  join_type?: string,
  name?: string,
  on?: { left: string, right: string }[]
}
export type QueryData = { field: string, value: any }
export type QueryCondition = { field: string, comparator?: string, value: any }
  | any[3] | any[2]
// | [string, string, string | number | boolean] | [string, string | number | boolean]
export type QueryOrder = { field: string, is_asc: boolean }

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

// Basic DBClass interface, all objects connecting to a database should implement this
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
}

// Basic CacheClass interface, all objects connecting to a cache should implement this
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
  disableOfflineQueue?: boolean,
  tls?: boolean,
  checkServerIdentity?: any,
  cluster?: boolean,
  logLevel?: string,
  slotsRefreshTimeout?: number, // timeout on topology refresh, only work with cluster is true
  slotsRefreshInterval?: number, // inteval on topology refresh, only work with cluster is true
}

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

export type QueueMessage = {
  topic: string,
  message: String,
  key: String,
  headers?: Object,
  ingressionTs?: number
}

// Basic QueueClass interface, all objects connecting to a queue should implement this
// For Kafka, the send function will always return null as direct message reply is not supported
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
