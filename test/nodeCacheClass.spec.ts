import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import proxyquire from 'proxyquire'
import NodeCacheClass from '../src/nodeCacheClass'

const standaloneConfig = {
  client: 'nodecache',
  cacheTTL: 100,
  pingInterval: 120,
}

describe('NodeCacheClass', () => {
  describe('Class constructor throw error correctly', () => {
    it('throw error correctly', async () => {
      const invalidConfigs = [
        { ...standaloneConfig, client: 'notnodecache' },
      ]
      await Promise.all(invalidConfigs.map(async (c) => {
        await assert.rejects(
          async () => {
            // @ts-ignore
            const nodeCacheClassWhichNotWork = new NodeCacheClass(c)
            assert.fail(new Error(`should throw error but did not ${c}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, 'Invalid Node cache config')
            return true
          },
        )
      }))
    })
  })

  describe('Instance methods', () => {
    let clientStub: any
    let nodeCacheClass: NodeCacheClass
    const tempStore: any = []
    const tempStoreTTL: any = []
    let isAllTTLUndefined = false
    let isAllTTLNotExpired = false

    before(() => {
      clientStub = {
        on: sinon.stub(),
        get: sinon.stub().callsFake((key: string) => (tempStore[key] ?? undefined)),
        getTtl: sinon.stub().callsFake((key: string) => {
          if (isAllTTLUndefined) return undefined
          if (isAllTTLNotExpired) return 0
          return (tempStoreTTL[key] ? Date.now() + tempStoreTTL[key] : undefined)
        }),
        set: sinon.stub().callsFake((key: string, value: string, ttl: number) => {
          tempStore[key] = value
          if (ttl > 0) {
            tempStoreTTL[key] = ttl * 1000
          } else {
            tempStoreTTL[key] = 0
          }
          return true
        }),
        del: sinon.stub().callsFake((key: string) => {
          tempStore[key] = undefined
          tempStoreTTL[key] = undefined
        }),
        flushAll: sinon.stub(),
        close: sinon.stub(),
      }
      const IORedisStub: any = sinon.stub().returns(clientStub)
      const NodeCacheClassStub = proxyquire('../src/nodeCacheClass', {
        'node-cache': IORedisStub,
      }).default

      nodeCacheClass = new NodeCacheClassStub(standaloneConfig)
    })

    after(async () => {
      await nodeCacheClass.disconnect()
    })

    it('connect work correctly', async () => {
      clientStub.on.resetHistory()
      await nodeCacheClass.connect()
      assert.strictEqual(clientStub.on.callCount, 5)
      clientStub.on.resetHistory()
    })

    it('disconnect work correctly', async () => {
      clientStub.close.resetHistory()
      await nodeCacheClass.connect()
      await nodeCacheClass.disconnect()
      assert.strictEqual(clientStub.close.callCount, 1)
      clientStub.close.resetHistory()
    })

    it('isconnect work correctly', async () => {
      await nodeCacheClass.connect()
      assert.strictEqual(await nodeCacheClass.isconnect(), true)
      await nodeCacheClass.disconnect()
      assert.strictEqual(await nodeCacheClass.isconnect(), false)
    })

    it('getConfig work correctly', async () => {
      assert.deepStrictEqual(nodeCacheClass.getConfig(), {
        stdTTL: standaloneConfig.cacheTTL,
        checkperiod: standaloneConfig.pingInterval,
        revalidate: 60,
        useClones: true,
        cacheHeader: 'dbCache:',
      })
    })

    it('getPoolClient work correctly', async () => {
      assert.strictEqual(await nodeCacheClass.getPoolClient(), clientStub)
    })

    it('buildCache and query work correctly', async () => {
      clientStub.get.resetHistory()
      clientStub.getTtl.resetHistory()
      clientStub.set.resetHistory()
      clientStub.del.resetHistory()
      const testQuery = { text: 'select 1', values: [] }
      const testResult = { rows: [{ id: 1 }], count: 1, ttl: undefined }
      assert.strictEqual(await nodeCacheClass.query(testQuery), undefined)
      assert.strictEqual(clientStub.get.callCount, 1)
      await nodeCacheClass.buildCache(testQuery, testResult, 2) // TTL 2 seconds
      assert.strictEqual(clientStub.set.callCount, 2)
      assert.strictEqual(clientStub.del.callCount, 1)
      assert.deepStrictEqual(await nodeCacheClass.query(testQuery), { ...testResult, ttl: 2 })
      assert.strictEqual(clientStub.get.callCount, 2)
      assert.strictEqual(clientStub.getTtl.callCount, 1)
      clientStub.get.resetHistory()
      clientStub.getTtl.resetHistory()
      clientStub.set.resetHistory()
      clientStub.del.resetHistory()
      const testQuery2 = { text: 'select 2', values: [] }
      const testResult2 = { rows: [{ id: 2 }, { id: 1 }], count: 2, ttl: undefined }
      await nodeCacheClass.buildCache(testQuery2, testResult2)
      assert.strictEqual(clientStub.set.callCount, 2)
      assert.strictEqual(clientStub.del.callCount, 1)
      assert.deepStrictEqual(
        await nodeCacheClass.query(testQuery2),
        { ...testResult2, ttl: standaloneConfig.cacheTTL },
      )
      assert.strictEqual(clientStub.get.callCount, 1)
      assert.strictEqual(clientStub.getTtl.callCount, 1)
      await nodeCacheClass.buildCache(testQuery2, testResult2)
      assert.strictEqual(clientStub.set.callCount, 4)
      assert.strictEqual(clientStub.del.callCount, 2)
      isAllTTLUndefined = true
      assert.deepStrictEqual(
        await nodeCacheClass.query(testQuery2),
        { ...testResult2, ttl: 0 },
      )
      assert.strictEqual(clientStub.get.callCount, 2)
      assert.strictEqual(clientStub.getTtl.callCount, 2)
      isAllTTLUndefined = false
      isAllTTLNotExpired = true
      assert.deepStrictEqual(
        await nodeCacheClass.query(testQuery),
        { ...testResult, ttl: -1 },
      )
      isAllTTLNotExpired = false
      assert.strictEqual(clientStub.get.callCount, 3)
      assert.strictEqual(clientStub.getTtl.callCount, 3)
    })

    it('clearCache work correctly', async () => {
      const testQuery = { text: 'select 1', values: [] }
      const testResult = { rows: [{ id: 1 }], count: 1, ttl: undefined }
      await nodeCacheClass.buildCache(testQuery, testResult)
      assert.deepStrictEqual(
        await nodeCacheClass.query(testQuery),
        { ...testResult, ttl: standaloneConfig.cacheTTL },
      )
      clientStub.del.resetHistory()
      await nodeCacheClass.clearCache(testQuery)
      assert.strictEqual(clientStub.del.callCount, 1)
      assert.strictEqual(await nodeCacheClass.query(testQuery), undefined)
    })

    it('clearAllCache work correctly', async () => {
      clientStub.flushAll.resetHistory()
      await nodeCacheClass.clearAllCache()
      assert.strictEqual(clientStub.flushAll.callCount, 1)
    })
  })
})
