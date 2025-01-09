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

export type DBConfig = {
  client: string,
  endpoint: string,
  port: number,
  database: string,
  username: string,
  password: string,
  poolSize?: number,
  ssl?: boolean,
  logLevel?: string,
  idleTimeoutMillis?: number,
  minConnection?: number,
  maxConnection?: number,
  allowExitOnIdle?: boolean
}

export type CacheConfig = {
  client: string,
  connection: string,
  username?: string,
  password?: string,
  dbIndex?: string,
  cacheHeader?: string,
  cacheTTL?: number,
  revalidate?: number
}
