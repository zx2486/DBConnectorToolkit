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
  insert(_table: string, _data: QueryData[]): Promise<QueryResult>
  update(_table: string, _data: QueryData[],
    _conditions?: { array: QueryCondition[], is_or: boolean }
  ): Promise<QueryResult>
  upsert(_table: string, _indexData: string[], _data: QueryData[]): Promise<QueryResult>
  delete(_table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean }
  ): Promise<QueryResult>
}

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
}
