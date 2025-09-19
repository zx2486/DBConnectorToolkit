import assert from 'assert'
import {
  describe, it,
} from 'mocha'

import dbConnector from '../src/index'
import { getCacheObj, getDBObj } from '../src/indexInternal'
import PgClass from '../src/pgClass'
import MariaClass from '../src/mariaClass'
import SQLite3Class from '../src/sqlite3Class'
import RedisClass from '../src/redisClass'
import IORedisClass from '../src/ioredisClass'
import NodeCacheClass from '../src/nodeCacheClass'
import MemcachedClass from '../src/memcachedClass'
import DBConnectorClass from '../src/dbConnectorClass'

describe('dbConnector', () => {
  const masterConfig = {
    client: 'pg',
    endpoint: 'localhost',
    port: 5432,
    database: 'test',
    username: 'user',
    password: 'password',
  }
  const replicaConfig = [
    {
      client: 'pg',
      endpoint: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'password',
    },
    {
      client: 'pg',
      endpoint: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'password',
    },
  ]
  const cacheConfig = {
    client: 'ioredis',
    url: 'localhost:6379',
  }
  const kafkaConfig = {
    client: 'kafka',
    appName: 'test-app',
    brokerList: ['localhost:9092'],
  }
  it('should throw an error if masterConfig is not provided', () => {
    assert.throws(() => dbConnector(undefined as any), new Error('Master DB config is required'))
  })

  it('should throw an error if masterConfig is invalid', () => {
    const invalidConfig = { client: 'invalidDB' }
    assert.throws(() => dbConnector(invalidConfig as any), 'Unsupported database client: invalidDB')
  })

  it('should create a DBConnectorClass instance under different setup', () => {
    const result = dbConnector(masterConfig)
    assert.ok(result instanceof DBConnectorClass)
    const result2 = dbConnector(masterConfig, replicaConfig)
    assert.ok(result2 instanceof DBConnectorClass)
    const result3 = dbConnector(masterConfig, undefined, cacheConfig)
    assert.ok(result3 instanceof DBConnectorClass)
    const result4 = dbConnector(masterConfig, replicaConfig, cacheConfig)
    assert.ok(result4 instanceof DBConnectorClass)
    const result5 = dbConnector(masterConfig, undefined, undefined, kafkaConfig)
    assert.ok(result5 instanceof DBConnectorClass)
    const result6 = dbConnector(masterConfig, replicaConfig, cacheConfig, kafkaConfig)
    assert.ok(result6 instanceof DBConnectorClass)
  })
})

describe('getDBObj and getCacheObj', () => {
  it('should getCacheObj return undefined for invalid or missing cacheConfig', () => {
    assert.strictEqual(getCacheObj(undefined), undefined)
    assert.strictEqual(getCacheObj({} as any), undefined)
    assert.strictEqual(getCacheObj({ client: 'invalidClient' }), undefined)
    assert.ok(getCacheObj({ client: 'redis', url: 'localhost:6379' }) instanceof RedisClass)
    assert.ok(getCacheObj({ client: 'ioredis', url: 'localhost:6379' }) instanceof IORedisClass)
    assert.ok(getCacheObj({ client: 'nodecache' }) instanceof NodeCacheClass)
    assert.ok(getCacheObj({ client: 'memcached', url: 'localhost:11211' }) instanceof MemcachedClass)
  })

  it('should getDBObj return undefined for invalid or missing dbConfig', () => {
    assert.strictEqual(getDBObj(undefined), undefined)
    assert.strictEqual(getDBObj({} as any), undefined)
    assert.strictEqual(getDBObj({ client: 'invalidDB' } as any), undefined)
    assert.ok(getDBObj({
      client: 'pg',
      endpoint: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'password',
    }) instanceof PgClass)
    assert.ok(getDBObj({
      client: 'mariadb',
      endpoint: 'localhost',
      port: 3306,
      database: 'test',
      username: 'user',
      password: 'password',
    }) instanceof MariaClass)
    assert.ok(getDBObj({
      client: 'sqlite3',
      endpoint: ':memory:',
    }) instanceof SQLite3Class)
  })
})
