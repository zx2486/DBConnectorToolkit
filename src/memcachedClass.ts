import Memcached from 'memcached'
import bunyan from 'bunyan'
import type {
  Query, QueryResult, CacheConfig, CacheClass,
} from './baseClass'
import IORedisClass from './ioredisClass'

export default class MemcachedClass implements CacheClass {
  private targetServer: string | string[]
  private cacheConfig: any
  private cacheClient: any
  private logger: bunyan

  constructor(_config: CacheConfig) {
    if (!_config || _config.client !== 'memcached' || !_config.url) {
      throw new Error('Invalid memcached config')
    }
    this.logger = bunyan.createLogger({
      name: 'MemcachedClass',
      streams: [{ stream: process.stderr, level: _config.logLevel as bunyan.LogLevel }],
    })

    this.targetServer = (_config.additionalNodeList && _config.additionalNodeList.length > 0)
      ? [_config.url, ..._config.additionalNodeList] : _config.url

    this.cacheConfig = {
      cacheTTL: _config.cacheTTL || 0, // default TTL in seconds, 0 = unlimited
      revalidate: -100, // make sure revalidate is not used
      cacheHeader: (_config.cacheHeader) ? `${_config.cacheHeader}:` : 'dbCache:',
      reconnect: (_config.pingInterval) ? _config.pingInterval * 1000 : 18000000, // default 5 hours
      timeout: (_config.connectTimeout) ? _config.connectTimeout * 1000 : 5000, // default 5s
      idle: (_config.keepAlive) ? _config.keepAlive * 1000 : 5000, // default 5s
    }
  }

  async connect() {
    try {
      if (!this.cacheClient) {
        const newClient = new Memcached('localhost:11211', { ...this.cacheConfig })
        newClient.on('issue', (details: any) => {
          this.logger.info({ event: 'Issue with server', ...details })
        })
        newClient.on('failure', (details: any) => {
          this.logger.info({ event: 'Server is dead or failure', ...details })
        })
        newClient.on('reconnecting', (details: any) => {
          this.logger.info({ event: 'Reconnecting to a failed server', ...details })
        })
        newClient.on('reconnect', (details: any) => {
          this.logger.info({ event: 'Reconnect to a server succussfully', ...details })
        })
        newClient.on('remove', (details: any) => {
          this.logger.info({ event: 'Removing a server from consistent hashing', ...details })
        })
        this.cacheClient = newClient
      }
    } catch (err) {
      this.logger.error({ event: 'MemcachedClass - connect', err })
      throw new Error('Fail to connect to Memcached')
    }
  }

  async disconnect() {
    if (this.cacheClient) {
      this.cacheClient.end()
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

  async query(_query: Query): Promise<QueryResult | undefined> {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`

    return new Promise((resolve, reject) => {
      this.cacheClient.get(hashKey, (err: any, data: any) => {
        if (err) {
          this.logger.info({ event: `Cannot get data from ${hashKey}`, ...err })
          resolve(undefined)
          return
        }
        if (!data) {
          resolve(undefined)
          return
        }
        try {
          const parsedResult = JSON.parse(data)
          resolve({ ...parsedResult, ttl: -1 }) // We cannot get ttl from memcached
        } catch (parseError) {
          reject(parseError) // Resolve with undefined on parse error
        }
      })
    })
  }

  async buildCache(_query: Query, _result: QueryResult, customTTL?: number): Promise<void> {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`

    return new Promise((resolve, reject) => {
      const lockKey = `${hashKey}:lock`
      this.cacheClient.touch(lockKey, 10, (err: any) => {
        // get a lock to make sure only one process is writing to the cache
        if (err) {
          this.logger.info({ event: `Cannot get lock from ${lockKey}`, ...err })
          resolve()
          return
        }
        this.cacheClient.set(
          hashKey,
          JSON.stringify(_result),
          customTTL || this.cacheConfig.cacheTTL,
          (setErr: any) => {
            if (setErr) {
              this.logger.info({ event: `Cannot set data to ${hashKey}`, ...setErr })
              reject(setErr)
              return
            }
            this.cacheClient.del(lockKey)
            resolve()
          },
        )
      })
    })
  }

  async clearCache(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${IORedisClass.hashkeyOf(_query)}`
    this.cacheClient.del(hashKey)
  }

  async clearAllCache() {
    if (!this.cacheClient) await this.connect()
    this.cacheClient.flush()
  }
}
