import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import proxyquire from 'proxyquire'
import IORedisClass from '../src/ioredisClass'

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
  client: 'ioredis',
  url: 'localhost:6379',
}
const clusterConfig = {
  client: 'ioredis',
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
describe('ioredisClass', () => {
  describe('Static methods', () => {
    it('shoule hashkeyOf correctly', () => {
      queryCases.forEach(({ text, values, expected }) => {
        assert.strictEqual(IORedisClass.hashkeyOf({ text, values }), expected)
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
            const redisClassWhichNotWork = new IORedisClass(c)
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
    let redisClass: IORedisClass
    let redisClass2: IORedisClass
    let redisClass3: IORedisClass
    let redisClass4: IORedisClass
    let isRedisWorking: boolean = true
    let flushCount: number = 0

    before(() => {
      // Stub the createClient and createCluster methods
      clientStub = {
        connect: sinon.stub().callsFake(() => {
          if (!isRedisWorking) {
            throw new Error('Redis is not working')
          }
        }),
        quit: sinon.stub().resolves(),
        on: sinon.stub(),
        get: sinon.stub().resolves(JSON.stringify({ rows: [{ id: 'key1' }], count: 1 })),
        set: sinon.stub().resolves(),
        select: sinon.stub().resolves(),
        ttl: sinon.stub().resolves(3600),
        del: sinon.stub().resolves(),
        flushdb: sinon.stub().callsFake(() => {
          flushCount += 1
          return Promise.resolve()
        }),
        nodes: sinon.stub().returns(
          Array.from({ length: 3 }, () => ({
            flushdb: sinon.stub().callsFake(() => {
              flushCount += 1
              return Promise.resolve()
            }),
          })),
        ),
      }
      Object.defineProperty(clientStub, 'status', {
        get: () => (!isRedisWorking ? 'connecting' : 'ready'),
      })
      const IORedisStub: any = sinon.stub().returns(clientStub)
      IORedisStub.Cluster = sinon.stub().returns(clientStub)

      const StubRedisClass = proxyquire('../src/ioredisClass', {
        ioredis: IORedisStub,
      }).default
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
      clientStub.quit.resetHistory()
      await redisClass.connect()
      await redisClass.disconnect()
      assert.strictEqual(clientStub.quit.callCount, 1)
      clientStub.quit.resetHistory()
      await redisClass2.connect()
      await redisClass2.disconnect()
      assert.strictEqual(clientStub.quit.callCount, 1)
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
      assert.strictEqual(await redisClass.isconnect(), false)
      await redisClass.connect()
      assert.strictEqual(await redisClass.isconnect(), true)

      assert.strictEqual(await redisClass2.isconnect(), false)
      await redisClass2.connect()
      assert.strictEqual(await redisClass2.isconnect(), true)
      isRedisWorking = false
      assert.strictEqual(await redisClass.isconnect(), false)
      assert.strictEqual(await redisClass2.isconnect(), false)
      isRedisWorking = true
    })

    it('should getPoolClient correctly', async () => {
      assert.strictEqual(await redisClass.getPoolClient(), clientStub)
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
      clientStub.del.resetHistory()
      await redisClass.clearCache({ text: 'GET key', values: [] })
      assert.strictEqual(clientStub.del.callCount, 1)
      await redisClass2.clearCache({ text: 'GET key', values: [] })
      assert.strictEqual(clientStub.del.callCount, 2)
    })

    it('should clearAllCache correctly', async () => {
      flushCount = 0
      await redisClass.clearAllCache()
      assert.strictEqual(flushCount, 1)
      await redisClass2.clearAllCache()
      assert.strictEqual(flushCount, 4)
    })
  })
})
