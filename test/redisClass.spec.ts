import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import proxyquire from 'proxyquire'
import { RedisClass } from '../src/redisClass'

const queryCases = [
  {
    text: 'SELECT * FROM users WHERE id = $1',
    values: ['test'],
    expected: '5a3ca53501befa2d6d2c87a304e14364c11519c470bf0ae4d59f67094a8b6d80',
  },
  {
    text: 'SELECT * FROM users WHERE id = $1 and active = $2 and age > $3',
    values: ['test', true, 3],
    expected: '7476fc2252eee84f2a8ed104e66243b98f8a9b34b8a0a95734edae0e467984b5',
  },
  {
    text: 'SELECT * FROM users WHERE active = $1 AND age = ANY($2)',
    values: [true, [3, 14, 25]],
    expected: '26357f686d01c36a45e3d1131cda3d9f02ed9711adf4ca8f5671df641c7c976d',
  },
]
const standaloneConfig = {
  client: 'redis',
  url: 'localhost:6379',
}
const clusterConfig = {
  client: 'redis',
  url: 'localhost:6379',
  additionalNodeList: ['peer1:6379', 'peer2:6379'],
  username: 'username',
  password: 'password',
  dbIndex: 2,
  cacheHeader: 'redis-cache',
  cacheTTL: 60,
  revalidate: 5,
  pingInterval: 300,
  connectTimeout: 1000,
  keepAlive: 10,
  reconnectStrategy: (_retries: number) => 5,
  disableOfflineQueue: true,
  tls: true,
  checkServerIdentity: () => undefined,
  cluster: true,
  logLevel: 'error',
}
describe('redisClass', () => {
  describe('Static methods', () => {
    it('shoule hashkeyOf correctly', () => {
      queryCases.forEach(({ text, values, expected }) => {
        assert.strictEqual(RedisClass.hashkeyOf({ text, values }), expected)
      })
    })
  })

  describe('Class constructor throw error correctly', () => {
    it('throw error correctly', async () => {
      const invalidConfigs = [
        { ...standaloneConfig, client: 'notredis' },
        { ...standaloneConfig, url: '' },
        { ...clusterConfig, client: 'notredis' },
        { ...clusterConfig, url: '' },
      ]
      await Promise.all(invalidConfigs.map(async (c) => {
        await assert.rejects(
          async () => {
            const redisClassWhcihNotWork = new RedisClass(c)
            assert.fail(new Error(`should throw error but did not ${c}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, 'Invalid Redis config')
            return true
          },
        )
      }))
    })
  })

  describe('Instance methods', () => {
    let clientStub: any
    let redisClass: RedisClass
    let redisClass2: RedisClass
    let redisClass3: RedisClass
    let redisClass4: RedisClass
    let isRedisWorking: boolean = true

    before(() => {
      // Stub the createClient and createCluster methods
      clientStub = {
        connect: sinon.stub().callsFake(() => {
          if (!isRedisWorking) {
            throw new Error('Redis is not working')
          }
        }),
        destroy: sinon.stub().callsFake(() => {
          if (!isRedisWorking) {
            throw new Error('Redis is not working')
          }
        }),
        on: sinon.stub(),
        ping: sinon.stub().callsFake(() => {
          if (!isRedisWorking) {
            throw new Error('Redis is not working')
          }
          return 'PONG'
        }),
        createPool: sinon.stub().callsFake(() => {
          if (!isRedisWorking) {
            throw new Error('Redis is not working')
          }
          return {
            on: sinon.stub(),
          }
        }),
        get: sinon.stub().resolves({ rows: [{ id: 'key1' }], count: 1 }),
        set: sinon.stub().resolves(),
        select: sinon.stub().resolves(),
        ttl: sinon.stub().resolves(3600),
        clear: sinon.stub().resolves(),
        flushall: sinon.stub().resolves(),
      }

      const StubRedisClass = proxyquire('../src/redisClass', {
        redis: {
          createClient: sinon.stub().returns(clientStub),
          createCluster: sinon.stub().returns(clientStub),
        },
      }).RedisClass
      redisClass = new StubRedisClass(standaloneConfig)
      redisClass2 = new StubRedisClass(clusterConfig)
      redisClass3 = new StubRedisClass(standaloneConfig)
      redisClass4 = new StubRedisClass(clusterConfig)
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should connect correctly', async () => {
      clientStub.on.resetHistory()
      clientStub.connect.resetHistory()
      await redisClass.connect()
      assert.strictEqual(clientStub.on.callCount, 5)
      assert.strictEqual(clientStub.connect.callCount, 1)
      clientStub.on.resetHistory()
      clientStub.connect.resetHistory()
      await redisClass2.connect()
      assert.strictEqual(clientStub.on.callCount, 5)
      assert.strictEqual(clientStub.connect.callCount, 1)
    })

    it('should connect fail if redis is not working', async () => {
      isRedisWorking = false
      try {
        await redisClass3.connect()
      } catch (err: any) {
        assert.strictEqual(err.message, 'Fail to connect to Redis')
      }
      try {
        await redisClass4.connect()
      } catch (err: any) {
        assert.strictEqual(err.message, 'Fail to connect to Redis')
      }
      isRedisWorking = true
    })

    it('should disconnect correctly', async () => {
      clientStub.destroy.resetHistory()
      await redisClass.connect()
      await redisClass.disconnect()
      assert.strictEqual(clientStub.destroy.callCount, 1)
      clientStub.destroy.resetHistory()
      await redisClass2.connect()
      await redisClass2.disconnect()
      assert.strictEqual(clientStub.destroy.callCount, 1)
    })

    it('should disconnect fail if redis is not working', async () => {
      await redisClass.connect()
      isRedisWorking = false
      try {
        await redisClass.disconnect()
      } catch (err: any) {
        assert.strictEqual(err.message, 'Fail to disconnect from Redis')
      }
      isRedisWorking = true
      await redisClass2.connect()
      isRedisWorking = false
      try {
        await redisClass2.disconnect()
      } catch (err: any) {
        assert.strictEqual(err.message, 'Fail to disconnect from Redis')
      }
      isRedisWorking = true
    })

    it('should isconnect correctly', async () => {
      await redisClass.disconnect()
      await redisClass2.disconnect()
      clientStub.ping.resetHistory()
      assert.strictEqual(await redisClass.isconnect(), false)
      await redisClass.connect()
      assert.strictEqual(await redisClass.isconnect(), true)
      assert.strictEqual(clientStub.ping.callCount, 1)
      clientStub.ping.resetHistory()
      assert.strictEqual(await redisClass2.isconnect(), false)
      await redisClass2.connect()
      assert.strictEqual(await redisClass2.isconnect(), true)
      assert.strictEqual(clientStub.ping.callCount, 1)
      isRedisWorking = false
      clientStub.ping.resetHistory()
      assert.strictEqual(await redisClass.isconnect(), false)
      assert.strictEqual(clientStub.ping.callCount, 1)
      clientStub.ping.resetHistory()
      assert.strictEqual(await redisClass2.isconnect(), false)
      assert.strictEqual(clientStub.ping.callCount, 1)
      isRedisWorking = true
    })

    it('should getPoolClient correctly', async () => {
      clientStub.createPool.resetHistory()
      await redisClass.getPoolClient()
      assert.strictEqual(clientStub.createPool.callCount, 1)
      clientStub.createPool.resetHistory()
      await redisClass2.getPoolClient()
      assert.strictEqual(clientStub.createPool.callCount, 1)
      isRedisWorking = false
      try {
        await redisClass.getPoolClient()
      } catch (err: any) {
        assert.strictEqual(err.message, 'Fail to get pool client')
      }
      try {
        await redisClass2.getPoolClient()
      } catch (err: any) {
        assert.strictEqual(err.message, 'Fail to get pool client')
      }
      isRedisWorking = true
    })

    it('should query correctly', async () => {
      clientStub.get.resetHistory()
      clientStub.ttl.resetHistory()
      const result = await redisClass.query({ text: 'GET key', values: [] })
      assert.deepStrictEqual(result, { rows: [{ id: 'key1' }], count: 1, ttl: 3600 })
      assert.strictEqual(clientStub.get.callCount, 1)
      assert.strictEqual(clientStub.ttl.callCount, 1)
      const result2 = await redisClass2.query({ text: 'GET key', values: [] })
      assert.deepStrictEqual(result2, { rows: [{ id: 'key1' }], count: 1, ttl: 3600 })
      assert.strictEqual(clientStub.get.callCount, 2)
      assert.strictEqual(clientStub.ttl.callCount, 2)
    })

    it('should buildCache correctly', async () => {
      clientStub.set.resetHistory()
      await redisClass.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
        87654,
      )
      assert.strictEqual(clientStub.set.callCount, 1)
      clientStub.set.getCall(0).args[1] = { rows: [{ id: 'key1' }], count: 1, ttl: 3600 }
      clientStub.set.getCall(0).args[2] = 87654
      await redisClass.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
      )
      assert.strictEqual(clientStub.set.callCount, 2)
      clientStub.set.getCall(1).args[1] = { rows: [{ id: 'key1' }], count: 1, ttl: 3600 }
      clientStub.set.getCall(1).args[2] = 3600

      clientStub.set.resetHistory()
      await redisClass2.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
        87654,
      )
      assert.strictEqual(clientStub.set.callCount, 1)
      clientStub.set.getCall(0).args[1] = { rows: [{ id: 'key1' }], count: 1, ttl: 3600 }
      clientStub.set.getCall(0).args[2] = 87654
      await redisClass2.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
      )
      assert.strictEqual(clientStub.set.callCount, 2)
      clientStub.set.getCall(1).args[1] = { rows: [{ id: 'key1' }], count: 1, ttl: 3600 }
      clientStub.set.getCall(1).args[2] = 60
    })

    it('should clearCache correctly', async () => {
      clientStub.clear.resetHistory()
      await redisClass.clearCache({ text: 'GET key', values: [] })
      assert.strictEqual(clientStub.clear.callCount, 1)
      await redisClass2.clearCache({ text: 'GET key', values: [] })
      assert.strictEqual(clientStub.clear.callCount, 2)
    })

    it('should clearAllCache correctly', async () => {
      clientStub.flushall.resetHistory()
      await redisClass.clearAllCache()
      assert.strictEqual(clientStub.flushall.callCount, 1)
      await redisClass2.clearAllCache()
      assert.strictEqual(clientStub.flushall.callCount, 2)
    })
  })
})
