import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import proxyquire from 'proxyquire'
import MemcachedClass from '../src/memcachedClass'

const standaloneConfig = {
  client: 'memcached',
  url: 'localhost:6379',
}
const clusterConfig = {
  client: 'memcached',
  url: 'localhost:6379',
  additionalNodeList: ['peer1:6379', 'peer2:6379'],
  cacheHeader: 'mem-cache',
  cacheTTL: 60,
  pingInterval: 300,
  connectTimeout: 1000,
  keepAlive: 10,
  logLevel: 'error',
}
describe('MemcachedClass', () => {
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
            const memcachedClassWhichNotWork = new MemcachedClass(c)
            assert.fail(new Error(`should throw error but did not ${c}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, 'Invalid memcached config')
            return true
          },
        )
      }))
    })
  })

  describe('Instance methods', () => {
    let clientStub: any
    let redisClass: MemcachedClass
    let redisClass2: MemcachedClass
    let flushCount: number = 0

    before(() => {
      clientStub = {
        on: sinon.stub(),
        get: sinon.stub().callsFake((key: string, callback: Function) => {
          callback(null, JSON.stringify({ rows: [{ id: 'key1' }], count: 1 }))
        }),
        touch: sinon.stub().callsFake((key: string, value: any, callback: Function) => {
          callback(null)
        }),
        set: sinon.stub().callsFake((key: string, value: any, ttl: number, callback: Function) => {
          callback(null)
        }),
        del: sinon.stub().resolves(),
        flush: sinon.stub().callsFake(() => {
          flushCount += 1
          return Promise.resolve()
        }),
        end: sinon.stub(),
      }
      const IORedisStub: any = sinon.stub().returns(clientStub)

      const StubRedisClass = proxyquire('../src/memcachedClass', {
        memcached: IORedisStub,
      }).default
      redisClass = new StubRedisClass(standaloneConfig)
      redisClass2 = new StubRedisClass(clusterConfig)
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should connect correctly', async () => {
      clientStub.on.resetHistory()
      await redisClass.connect()
      assert.strictEqual(clientStub.on.callCount, 5)
      clientStub.on.resetHistory()
      await redisClass2.connect()
      assert.strictEqual(clientStub.on.callCount, 5)
    })

    it('should disconnect correctly', async () => {
      clientStub.end.resetHistory()
      await redisClass.connect()
      await redisClass.disconnect()
      assert.strictEqual(clientStub.end.callCount, 1)
      clientStub.end.resetHistory()
      await redisClass2.connect()
      await redisClass2.disconnect()
      assert.strictEqual(clientStub.end.callCount, 1)
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
    })

    it('should getPoolClient correctly', async () => {
      assert.strictEqual(await redisClass.getPoolClient(), clientStub)
    })

    it('should query correctly', async () => {
      clientStub.get.resetHistory()
      const result = await redisClass.query({ text: 'GET key', values: [] })
      assert.deepStrictEqual(result, { rows: [{ id: 'key1' }], count: 1, ttl: -1 })
      assert.strictEqual(clientStub.get.callCount, 1)
      const result2 = await redisClass2.query({ text: 'GET key', values: [] })
      assert.deepStrictEqual(result2, { rows: [{ id: 'key1' }], count: 1, ttl: -1 })
      assert.strictEqual(clientStub.get.callCount, 2)
    })

    it('should buildCache correctly', async () => {
      clientStub.touch.resetHistory()
      clientStub.set.resetHistory()
      clientStub.del.resetHistory()
      await redisClass.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
        87654,
      )
      assert.strictEqual(clientStub.set.callCount, 1)
      assert.strictEqual(clientStub.touch.callCount, 1)
      assert.strictEqual(clientStub.del.callCount, 1)
      await redisClass.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
      )
      assert.strictEqual(clientStub.set.callCount, 2)
      assert.strictEqual(clientStub.touch.callCount, 2)
      assert.strictEqual(clientStub.del.callCount, 2)

      clientStub.set.resetHistory()
      clientStub.touch.resetHistory()
      clientStub.del.resetHistory()
      await redisClass2.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
        87654,
      )
      assert.strictEqual(clientStub.set.callCount, 1)
      assert.strictEqual(clientStub.touch.callCount, 1)
      assert.strictEqual(clientStub.del.callCount, 1)
      await redisClass2.buildCache(
        { text: 'GET key', values: [] },
        { rows: [{ id: 'key1' }], count: 1, ttl: 3600 },
      )
      assert.strictEqual(clientStub.set.callCount, 2)
      assert.strictEqual(clientStub.touch.callCount, 2)
      assert.strictEqual(clientStub.del.callCount, 2)
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
      assert.strictEqual(flushCount, 2)
    })
  })
})
