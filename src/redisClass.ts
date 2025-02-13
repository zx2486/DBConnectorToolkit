import { createClient, createCluster } from 'redis'
import bunyan from 'bunyan'
import { createHash } from 'crypto'
import type { Query, QueryResult, CacheConfig } from './baseClass'

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

export class RedisClass implements CacheClass {
  private cacheConfig: any
  private cacheClient: any
  private logger: bunyan

  constructor(_config: CacheConfig) {
    if (!_config || _config.client !== 'redis') {
      throw new Error('Invalid DB config')
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
      cacheHeader: `${_config.cacheHeader}:` || '',
      cacheTTL: _config.cacheTTL || 3600,
      revalidate: _config.revalidate || 60,
    }
    if (_config.username && _config.password) {
      this.cacheConfig.options.username = _config.username
      this.cacheConfig.options.password = _config.password
      this.cacheConfig.options.socket.tls = _config.tls || true
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
          })
          : createClient({
            url: this.cacheConfig.url, ...this.cacheConfig.options, legacyMode: false,
          })
        newClient.on('error', (err: any) => {
          this.logger.error({ event: `Redis (${this.cacheConfig.url}) error`, err })
        })
        newClient.on('reconnecting', () => {
          this.logger.error({ event: `Redis (${this.cacheConfig.url}) reconnecting` })
        })
        newClient.on('end', () => {
          this.logger.error({ event: `Redis (${this.cacheConfig.url}) end` })
        })
        newClient.on('ready', () => {
          this.logger.info({ event: `Redis (${this.cacheConfig.url}) ready` })
        })
        newClient.on('connect', () => {
          this.logger.info({ event: `Redis (${this.cacheConfig.url}) connect` })
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
    const ttl = await this.cacheClient.ttl(hashKey)
    return { ...result, ttl }
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
    await this.cacheClient.set(hashKey, _result, customTTL || this.cacheConfig.cacheTTL)
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
