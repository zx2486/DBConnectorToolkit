import Redis from 'ioredis'
import bunyan from 'bunyan'
import { createHash } from 'crypto'
import type {
  Query, QueryResult, CacheConfig, CacheClass,
} from './baseClass'

export default class IORedisClass implements CacheClass {
  private cacheConfig: any
  private cacheClient: any
  private logger: bunyan

  constructor(_config: CacheConfig) {
    if (!_config || _config.client !== 'ioredis' || !_config.url) {
      throw new Error('Invalid Redis config')
    }
    this.logger = bunyan.createLogger({
      name: 'IORedisClass',
      streams: [{ stream: process.stderr, level: _config.logLevel as bunyan.LogLevel }],
    })
    this.cacheConfig = {
      host: (_config.url.replace('redis://', '').match(/^[^:]+/) || ['localhost'])[0],
      port: (_config.url.replace('redis://', '').match(/:(\d+)/) || [':6379', '6379'])[1],
      url: _config.url.replace('redis://', ''),
      options: {
        maxRetriesPerRequest: null,
        keepAlive: (_config.keepAlive) ? _config.keepAlive * 1000 : 0,
        reconnectOnError: (_config.reconnectOnError)
          ? _config.reconnectOnError
          : (err: any) => {
            // Default reconnect on error strategy
            if (err.message.includes('READONLY')) {
              return true // Reconnect on READONLY error
            }
            return false // Do not reconnect on other errors
          },
        retryStrategy: (_config.reconnectStrategy)
          ? _config.reconnectStrategy
          : (retries: number) => Math.min(retries * 50, 500),
        connectTimeout: (_config.connectTimeout) ? _config.connectTimeout * 1000 : 10000,
        enableOfflineQueue: !_config.disableOfflineQueue || true,
        db: _config.dbIndex || 0,
        lazyConnect: true, // Connect ondemand
      },
      is_cluster: _config.cluster || false,
      nodeList: _config.additionalNodeList && _config.additionalNodeList.length > 0
        ? _config.additionalNodeList : false,
      cacheHeader: (_config.cacheHeader) ? `${_config.cacheHeader}:` : 'dbCache:',
      cacheTTL: _config.cacheTTL || 3600,
      revalidate: _config.revalidate || 60,
    }
    if (_config.username && _config.password) {
      this.cacheConfig.options.username = _config.username
      this.cacheConfig.options.password = _config.password
      // if _config.tls is a function, assign it directly,
      // if it is a boolean, set tls to a default object
      const configTls = _config.tls
      if (configTls === true || typeof configTls === 'object') {
        this.cacheConfig.options.tls = (typeof configTls === 'object')
          ? configTls : {
            // skip certificate hostname validation
            // eslint-disable-next-line no-unused-vars
            checkServerIdentity: () => undefined,
          }
      }
    }
    if (_config.cluster) {
      this.cacheConfig.options.clusterRetryStrategy = (_config.reconnectStrategy)
        ? _config.reconnectStrategy
        : (retries: number) => Math.min(100 + retries * 2, 2000)
      this.cacheConfig.options.slotsRefreshTimeout = _config.slotsRefreshTimeout
        ? _config.slotsRefreshTimeout * 1000 : 1000
      this.cacheConfig.options.scaleReads = 'all'
    }
  }

  async connect() {
    try {
      if (!this.cacheClient) {
        const newClient = this.cacheConfig.is_cluster
          ? new Redis.Cluster(
            this.cacheConfig.nodeList
              ? [
                { port: this.cacheConfig.port, host: this.cacheConfig.host },
                ...this.cacheConfig.nodeList.map((url: string) => ({
                  host: (url.replace('redis://', '').match(/^[^:]+/) || ['localhost'])[0],
                  port: (url.replace('redis://', '').match(/:(\d+)/) || [':6379', '6379'])[1],
                })),
              ] : [{ port: this.cacheConfig.port, host: this.cacheConfig.host }],
            { ...this.cacheConfig.options },
          ) : new Redis(this.cacheConfig.port, this.cacheConfig.host, this.cacheConfig.options)
        const logList = ['reconnecting', 'end', 'ready', 'connect']
        logList.forEach((event) => {
          newClient.on(event, (err: any) => {
            this.logger.info({ event: `Redis (${this.cacheConfig.url}) ${event}`, err })
          })
        })
        newClient.on('error', (err: any) => {
          this.logger.error({ event: `Redis (${this.cacheConfig.url}) error`, err })
        })
        await newClient.connect()
        this.cacheClient = newClient
      }
    } catch (err) {
      this.logger.error({ event: 'IORedisClass - connect', err })
      throw new Error('Fail to connect to Redis')
    }
  }

  async disconnect() {
    try {
      if (this.cacheClient) {
        await this.cacheClient.quit()
        this.cacheClient = null
      }
    } catch (err) {
      this.logger.error({ event: 'IORedisClass - disconnect', err })
      throw new Error('Fail to disconnect from Redis')
    }
  }

  async isconnect() {
    try {
      if (this.cacheClient) return this.cacheClient.status === 'ready'
      return false
    } catch (err) {
      this.logger.info({ event: 'IORedisClass - isconnect', err })
    }
    return false
  }

  getConfig() {
    return this.cacheConfig
  }

  async getPoolClient() {
    try {
      // for ioredis, the pool client is the same as the client
      if (!this.cacheClient) await this.connect()
      return this.cacheClient
    } catch (err) {
      this.logger.error({ event: 'IORedisClass - getPoolClient', err })
      throw new Error('Fail to get pool client')
    }
  }

  async query(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    const result = await this.cacheClient.get(hashKey)
    if (!result) {
      return undefined
    }
    const parsedResult = JSON.parse(result)
    /* If the key does not exist, ioredis returns - 2 while node - redis returns 0
     * This function returns 0 if the key does not exist,
     * and - 1 if the key does not expire, consistent with RedisClass.
     */
    let ttl = await this.cacheClient.ttl(hashKey)
    if (ttl === -2) {
      ttl = 0
    }
    return { ...parsedResult, ttl }
  }

  static hashkeyOf(_query: Query) {
    const hash = createHash('sha256')
    const queryString = _query.text + JSON.stringify(_query.values)
    hash.update(queryString)
    return hash.digest('hex')
  }

  async buildCache(_query: Query, _result: QueryResult, customTTL?: number) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    // get a lock to make sure only one process is writing to the cache
    const lockKey = `${hashKey}:lock`
    const lockTTL = 10 // 10s
    const lock = await this.cacheClient.set(lockKey, '1', 'EX', lockTTL, 'NX')
    if (lock === 'OK') {
      await this.cacheClient.set(hashKey, JSON.stringify(_result), 'EX', customTTL || this.cacheConfig.cacheTTL)
      await this.cacheClient.del(lockKey)
    }
  }

  async clearCache(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    await this.cacheClient.del(hashKey)
  }

  async clearAllCache() {
    if (!this.cacheClient) await this.connect()
    // Send `FLUSHDB` command to all slaves:
    if (this.cacheConfig.is_cluster && this.cacheClient?.nodes) {
      const nodes = this.cacheClient.nodes('all')
      await Promise.all(nodes.map((node: any) => node.flushdb()))
    } else await this.cacheClient.flushdb()
  }
}
