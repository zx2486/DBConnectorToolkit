import NodeCache from 'node-cache'
import bunyan from 'bunyan'
import type {
  Query, QueryResult, CacheConfig, CacheClass,
} from './baseClass'
import IORedisClass from './ioredisClass'

export default class NodeCacheClass implements CacheClass {
  private cacheConfig: any
  private cacheClient: any
  private logger: bunyan

  constructor(_config: CacheConfig) {
    if (!_config || _config.client !== 'nodecache') {
      throw new Error('Invalid Node cache config')
    }
    this.logger = bunyan.createLogger({
      name: 'NodeCacheClass',
      streams: [{ stream: process.stderr, level: _config.logLevel as bunyan.LogLevel }],
    })
    this.cacheConfig = {
      stdTTL: _config.cacheTTL || 0, // default TTL in seconds, 0 = unlimited
      checkperiod: _config.pingInterval || 600, // 10 min
      revalidate: _config.revalidate || 60,
      useClones: true, // for simplicity and work like server cache, we always use clones
      cacheHeader: (_config.cacheHeader) ? `${_config.cacheHeader}:` : 'dbCache:',
    }
  }

  async connect() {
    try {
      if (!this.cacheClient) {
        const newClient = new NodeCache({ ...this.cacheConfig })
        newClient.on('set', (key: any) => {
          this.logger.info({ event: 'NodeCache set a value', key })
        })
        newClient.on('del', (key: any) => {
          this.logger.info({ event: 'NodeCache deleted a value', key })
        })
        newClient.on('expired', (key: any) => {
          this.logger.info({ event: 'NodeCache key expired', key })
        })
        newClient.on('flush', () => {
          this.logger.info({ event: 'NodeCache flushed' })
        })
        newClient.on('flush_stats', () => {
          this.logger.info({ event: 'NodeCache stats flushed' })
        })
        this.cacheClient = newClient
      }
    } catch (err) {
      this.logger.error({ event: 'NodeCacheClass - connect', err })
      throw new Error('Fail to connect to NodeCache')
    }
  }

  async disconnect() {
    if (this.cacheClient) {
      this.cacheClient.close()
      this.cacheClient = null
    }
  }

  async isconnect() {
    return (this.cacheClient) !== null
  }

  getConfig() {
    return this.cacheConfig
  }

  async getPoolClient() {
    if (!this.cacheClient) await this.connect()
    return this.cacheClient
  }

  async query(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    const result = this.cacheClient.get(hashKey)
    if (!result) {
      return undefined
    }
    const parsedResult = JSON.parse(result)
    /* If the key does not exist, nodecache returns undefined and 0 if not expiring
    * This function returns 0 if the key does not exist,
    * and - 1 if the key does not expire, consistent with RedisClass.
    */

    let ttl = this.cacheClient.getTtl(hashKey)
    if (ttl === 0) {
      ttl = -1
    } else if (ttl === undefined) {
      ttl = 0
    } else ttl = (ttl - Date.now()) / 1000 // change it into seconds to expire
    return { ...parsedResult, ttl }
  }

  async buildCache(_query: Query, _result: QueryResult, customTTL?: number) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    // get a lock to make sure only one process is writing to the cache
    const lockKey = `${hashKey}:lock`
    const lockTTL = 10 // 10s
    const lock = this.cacheClient.set(lockKey, '1', lockTTL)
    if (lock) {
      this.cacheClient.set(
        hashKey,
        JSON.stringify(_result),
        customTTL || this.cacheConfig.stdTTL,
      )
      this.cacheClient.del(lockKey)
    }
  }

  async clearCache(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    this.cacheClient.del(hashKey)
  }

  async clearAllCache() {
    if (!this.cacheClient) await this.connect()
    this.cacheClient.flushAll()
  }
}
