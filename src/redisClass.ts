import { createClient, createCluster } from 'redis'
import bunyan from 'bunyan'
import { createHash } from 'crypto'
import type {
  Query, QueryResult, CacheConfig, CacheClass,
} from './baseClass'

export default class RedisClass implements CacheClass {
  private cacheConfig: any
  private cacheClient: any
  private logger: bunyan

  constructor(_config: CacheConfig) {
    if (!_config || _config.client !== 'redis' || !_config.url) {
      throw new Error('Invalid Redis config')
    }
    this.logger = bunyan.createLogger({
      name: 'RedisClass',
      streams: [{ stream: process.stderr, level: _config.logLevel as bunyan.LogLevel }],
    })
    this.cacheConfig = {
      url: _config.url,
      options: {
        socket: {
          // keepalive: true,
          // reconnectStrategy: 5000,
          // restore to default values
          // https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
          keepAlive: _config.keepAlive || 5000,
          reconnectStrategy: (_config.reconnectStrategy)
            ? _config.reconnectStrategy
            : (retries: number) => Math.min(retries * 50, 500),
          connectTimeout: _config.connectTimeout || 1000,
        },
        disableOfflineQueue: _config.disableOfflineQueue || false,
        pingInterval: _config.pingInterval || 60000, // 60s,
        database: _config.dbIndex || 0,
      },
      is_cluster: _config.cluster || false,
      nodeList: _config.additionalNodeList && _config.additionalNodeList.length > 0
        ? [_config.url, ..._config.additionalNodeList] : false,
      cacheHeader: (_config.cacheHeader) ? `${_config.cacheHeader}:` : 'dbCache:',
      cacheTTL: _config.cacheTTL || 3600,
      revalidate: _config.revalidate || 60,
    }
    if (_config.cluster) {
      this.cacheConfig.options.cluster = {
        slotsRefreshTimeout: _config.slotsRefreshTimeout || 10000, // Default to 10 seconds
        slotsRefreshInterval: _config.slotsRefreshInterval || 30000, // Default to 30 seconds
      }
    }
    if (_config.username && _config.password) {
      this.cacheConfig.options.username = _config.username
      this.cacheConfig.options.password = _config.password
      this.cacheConfig.options.socket.tls = !!_config.tls
      // skip certificate hostname validation
      if (_config.checkServerIdentity) {
        this.cacheConfig.options.socket.checkServerIdentity = _config.checkServerIdentity
      }
      // this.cacheConfig.options.socket.checkServerIdentity = (servername, cert) => undefined
    }
  }

  async connect() {
    try {
      if (!this.cacheClient) {
        const newClient = this.cacheConfig.is_cluster
          ? createCluster({
            defaults: { ...this.cacheConfig.options },
            rootNodes: (this.cacheConfig.nodeList)
              ? this.cacheConfig.nodeList.map((url: string) => ({ url: `redis://${url}` }))
              : [{ url: `redis://${this.cacheConfig.url}` }],
            useReplicas: !!(this.cacheConfig.nodeList),
          })
          : createClient({
            url: `redis://${this.cacheConfig.url}`, ...this.cacheConfig.options, legacyMode: false,
          })
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
      this.logger.error({ event: 'RedisHelper - connect', err })
      throw new Error('Fail to connect to Redis')
    }
  }

  async disconnect() {
    try {
      if (this.cacheClient) {
        await this.cacheClient.destroy()
        this.cacheClient = null
      }
    } catch (err) {
      this.logger.error({ event: 'RedisHelper - disconnect', err })
      throw new Error('Fail to disconnect from Redis')
    }
  }

  async isconnect() {
    try {
      if (this.cacheClient) await this.cacheClient.ping()
      else return false
      return true
    } catch (err) {
      this.logger.info({ event: 'RedisHelper - isconnect', err })
    }
    return false
  }

  getConfig() {
    return this.cacheConfig
  }

  async getPoolClient() {
    try {
      if (!this.cacheClient) await this.connect()
      return await this.cacheClient.createPool()
        .on('error', (err: any) => {
          this.logger.error({ event: `Redis (${this.cacheConfig.url}) error on creating pool`, err })
        })
    } catch (err) {
      this.logger.error({ event: 'RedisHelper - getPoolClient', err })
      throw new Error('Fail to get pool client')
    }
  }

  async query(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${RedisClass.hashkeyOf(_query)}`
    const result = await this.cacheClient.get(hashKey)
    if (!result) {
      return undefined
    }
    const parsedResult = JSON.parse(result)
    const ttl = await this.cacheClient.ttl(hashKey)
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
    const hashKey = `${this.cacheConfig.cacheHeader}${RedisClass.hashkeyOf(_query)}`
    // get a lock to make sure only one process is writing to the cache
    const lockKey = `${hashKey}:lock`
    const lockTTL = 10 // 10s
    const lock = await this.cacheClient.set(lockKey, '1', {
      EX: lockTTL,
      NX: true,
    })
    if (lock === 'OK') {
      await this.cacheClient.set(hashKey, JSON.stringify(_result), {
        EX: customTTL || this.cacheConfig.cacheTTL,
      })
      await this.cacheClient.del(lockKey)
    }
  }

  async clearCache(_query: Query) {
    if (!this.cacheClient) await this.connect()
    const hashKey = `${this.cacheConfig.cacheHeader}${RedisClass.hashkeyOf(_query)}`
    await this.cacheClient.clear(hashKey)
  }

  async clearAllCache() {
    if (!this.cacheClient) await this.connect()
    await this.cacheClient.flushall()
  }
}
