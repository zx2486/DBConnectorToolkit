import type { Query, QueryResult, CacheConfig } from './baseClass.ts'

export interface CacheClass {
  getConfig(): CacheConfig
  connect(): Promise<void>
  disconnect(): Promise<void>
  isconnect(): boolean
  query(_query: Query): Promise<QueryResult>
  buildCache(_query: Query, _result: any): Promise<void>
  clearCache(_query: Query): Promise<void>
  clearAllCache(): Promise<void>
}

export class RedisClass implements CacheClass {
  private cacheConfig: CacheConfig
  private cache: any

  constructor(_config: CacheConfig) {
    this.cacheConfig = _config
  }

  getConfig() {
    return this.cacheConfig
  }

  async connect() {
    this.cache = { config: this.cacheConfig }
    return this.cache
  }

  async disconnect() {
    await this.cache.disconnect()
  }

  isconnect() {
    return this.cache.isconnect()
  }

  async query(_query: Query) {
    if (!this.cache.isconnect()) await this.cache.connect()
    const hashKey = RedisClass.hashkeyOf(_query)
    const result = this.cache.query(hashKey)
    const ttl = this.cache.ttl(hashKey)
    return { ...result, ttl }
  }

  static hashkeyOf(_query: Query) {
    return _query.text + _query.values
  }

  async buildCache(_query: Query, _result: any) {
    const key = RedisClass.hashkeyOf(_query)
    await this.cache.set(key, _result, this.cacheConfig?.cacheTTL || 3600)
  }

  async clearCache(_query: Query) {
    if (!this.cache.isconnect()) await this.cache.connect()
    await this.cache.clear(RedisClass.hashkeyOf(_query))
  }

  async clearAllCache() {
    if (!this.cache.isconnect()) await this.cache.connect()
    await this.cache.flushall()
  }
}
