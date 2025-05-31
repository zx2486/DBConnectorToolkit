import assert from 'assert'
import {
  describe, it, before,
} from 'mocha'
import sinon from 'ts-sinon'
import DBConnectorClass from '../src/dbConnectorClass'

describe('DBConnectorClass', () => {
  let dbConnector: DBConnectorClass
  let dbConnector2: DBConnectorClass
  let dbConnector3: DBConnectorClass
  let masterDB: any
  let replicaDB: any
  let redis: any
  let msgQueue: any

  before(() => {
    masterDB = {
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      isconnect: sinon.stub().resolves(true),
      buildSelectQuery: sinon.stub().returns({ text: 'SELECT * FROM users', fields: [] }),
      buildInsertQuery: sinon.stub(),
      buildUpdateQuery: sinon.stub(),
      buildUpsertQuery: sinon.stub(),
      buildDeleteQuery: sinon.stub(),
      query: sinon.stub().resolves({ rows: [{ id: 'key1' }], count: 1 }),
      select: sinon.stub(),
      insert: sinon.stub(),
      update: sinon.stub(),
      upsert: sinon.stub(),
      delete: sinon.stub(),
    }
    replicaDB = [
      {
        connect: sinon.stub(),
        disconnect: sinon.stub(),
        isconnect: sinon.stub().resolves(false),
        buildSelectQuery: sinon.stub(),
        query: sinon.stub().resolves({ rows: [{ id: 'key2' }], count: 2 }),
        select: sinon.stub(),
        insert: sinon.stub(),
        update: sinon.stub(),
        upsert: sinon.stub(),
        delete: sinon.stub(),
      },
      {
        connect: sinon.stub(),
        disconnect: sinon.stub(),
        isconnect: sinon.stub().resolves(false),
        buildSelectQuery: sinon.stub(),
        query: sinon.stub().resolves({ rows: [{ id: 'key2' }], count: 2 }),
        select: sinon.stub(),
        insert: sinon.stub(),
        update: sinon.stub(),
        upsert: sinon.stub(),
        delete: sinon.stub(),
      },
    ]
    redis = {
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      isconnect: sinon.stub().resolves(true),
      getConfig: sinon.stub().returns({ revalidate: 3600 }),
      getPoolClient: sinon.stub(),
      query: sinon.stub().callsFake((_query: any) => {
        if (!_query.text || _query.text === 'SELECT * FROM users') {
          return { rows: [{ id: 'key3' }], count: 3, ttl: 5 }
        }
        if (_query.text === 'long cache') {
          return { rows: [{ id: 'key3' }], count: 3, ttl: 7200 }
        }
        return undefined
      }),
      buildCache: sinon.stub(),
      clearCache: sinon.stub(),
      clearAllCache: sinon.stub(),
    }
    msgQueue = undefined
    dbConnector = new DBConnectorClass(masterDB, replicaDB, redis, msgQueue)
    dbConnector2 = new DBConnectorClass(masterDB, replicaDB, undefined, undefined)
    dbConnector3 = new DBConnectorClass(masterDB, undefined, undefined, undefined)
  })

  describe('connect, disconnect, isconnect', () => {
    it('should call connect for all db', async () => {
      masterDB.connect.resetHistory()
      replicaDB.forEach((element: any) => {
        element.connect.resetHistory()
      })
      redis.connect.resetHistory()
      await dbConnector.connect()
      assert.strictEqual(masterDB.connect.callCount, 1)
      // assert.strictEqual(replicaDB.connect.callCount, 1)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.connect.callCount, 1)
      })
      assert.strictEqual(redis.connect.callCount, 1)
      await dbConnector2.connect()
      assert.strictEqual(masterDB.connect.callCount, 2)
      // assert.strictEqual(replicaDB.connect.callCount, 2)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.connect.callCount, 2)
      })
      assert.strictEqual(redis.connect.callCount, 1)
      await dbConnector3.connect()
      assert.strictEqual(masterDB.connect.callCount, 3)
      // assert.strictEqual(replicaDB.connect.callCount, 2)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.connect.callCount, 2)
      })
      assert.strictEqual(redis.connect.callCount, 1)
    })
    it('should call disconnect for all db', async () => {
      masterDB.disconnect.resetHistory()
      // replicaDB.disconnect.resetHistory()
      replicaDB.forEach((element: any) => {
        element.disconnect.resetHistory()
      })
      redis.disconnect.resetHistory()
      await dbConnector.disconnect()
      assert.strictEqual(masterDB.disconnect.callCount, 1)
      // assert.strictEqual(replicaDB.disconnect.callCount, 1)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.disconnect.callCount, 1)
      })
      assert.strictEqual(redis.disconnect.callCount, 1)
      await dbConnector2.disconnect()
      assert.strictEqual(masterDB.disconnect.callCount, 2)
      // assert.strictEqual(replicaDB.disconnect.callCount, 2)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.disconnect.callCount, 2)
      })
      assert.strictEqual(redis.disconnect.callCount, 1)
      await dbConnector3.disconnect()
      assert.strictEqual(masterDB.disconnect.callCount, 3)
      // assert.strictEqual(replicaDB.disconnect.callCount, 2)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.disconnect.callCount, 2)
      })
      assert.strictEqual(redis.disconnect.callCount, 1)
    })
    it('should call isconnect for all db', async () => {
      masterDB.isconnect.resetHistory()
      // replicaDB.isconnect.resetHistory()
      replicaDB.forEach((element: any) => {
        element.isconnect.resetHistory()
      })
      redis.isconnect.resetHistory()
      assert.strictEqual(await dbConnector.isconnect(), false)
      assert.strictEqual(masterDB.isconnect.callCount, 1)
      // assert.strictEqual(replicaDB.isconnect.callCount, 1)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.isconnect.callCount, 1)
      })
      assert.strictEqual(redis.isconnect.callCount, 1)
      assert.strictEqual(await dbConnector2.isconnect(), false)
      assert.strictEqual(masterDB.isconnect.callCount, 2)
      // assert.strictEqual(replicaDB.isconnect.callCount, 2)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.isconnect.callCount, 2)
      })
      assert.strictEqual(redis.isconnect.callCount, 1)
      assert.strictEqual(await dbConnector3.isconnect(), true)
      assert.strictEqual(masterDB.isconnect.callCount, 3)
      // assert.strictEqual(replicaDB.isconnect.callCount, 2)
      replicaDB.forEach((element: any) => {
        assert.strictEqual(element.isconnect.callCount, 2)
      })
      assert.strictEqual(redis.isconnect.callCount, 1)
    })
  })

  describe('buildSelectQuery', () => {
    it('should call buildSelectQuery for masterDB', () => {
      masterDB.buildSelectQuery.resetHistory()
      dbConnector.buildSelectQuery([], [], undefined, undefined, undefined)
      assert(masterDB.buildSelectQuery.calledOnce)
    })
  })

  describe('query and select', () => {
    const resetQueryHistory = () => {
      masterDB.query.resetHistory()
      // replicaDB.query.resetHistory()
      replicaDB.forEach((element: any) => {
        element.query.resetHistory()
      })
      redis.query.resetHistory()
      redis.buildCache.resetHistory()
    }
    const strictEqualCheck = (masterC: number, replicaC: number, rC: number, bCC: number) => {
      assert.strictEqual(masterDB.query.callCount, masterC)
      const sumOfCalls: number = replicaDB.reduce(
        (acc: number, db: any) => acc + db.query.callCount,
        0,
      )
      assert.strictEqual(sumOfCalls, replicaC)
      assert.strictEqual(redis.query.callCount, rC)
      assert.strictEqual(redis.buildCache.callCount, bCC)
    }
    it('should call query according to logic', async () => {
      resetQueryHistory()
      // Write query goes to masterDB directly
      await dbConnector.query({ text: '', values: [] }, true)
      strictEqualCheck(1, 0, 0, 0)
      await dbConnector2.query({ text: '', values: [] }, true)
      strictEqualCheck(2, 0, 0, 0)
      await dbConnector3.query({ text: '', values: [] }, true)
      strictEqualCheck(3, 0, 0, 0)
      // if getLatest is true, read query goes to replicaDB if available
      resetQueryHistory()
      await dbConnector.query({ text: '', values: [] }, false, true)
      strictEqualCheck(0, 1, 0, 0)
      await dbConnector2.query({ text: '', values: [] }, false, true)
      strictEqualCheck(0, 2, 0, 0)
      await dbConnector3.query({ text: '', values: [] }, false, true)
      strictEqualCheck(1, 2, 0, 0)
      // if cache is available, read query goes to redis, and cache is updated
      resetQueryHistory()
      await dbConnector.query({ text: '', values: [] })
      // wait 0.01 seconds for redis to update cache
      await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
      strictEqualCheck(0, 1, 1, 1)
      await dbConnector2.query({ text: '', values: [] })
      strictEqualCheck(0, 2, 1, 1)
      await dbConnector3.query({ text: '', values: [] })
      strictEqualCheck(1, 2, 1, 1)
      // if cache is available and ttl is larger than revalidate, no need revalidate cache
      resetQueryHistory()
      await dbConnector.query({ text: 'long cache', values: [] })
      strictEqualCheck(0, 0, 1, 0)
      await dbConnector2.query({ text: 'long cache', values: [] })
      strictEqualCheck(0, 1, 1, 0)
      await dbConnector3.query({ text: 'long cache', values: [] })
      strictEqualCheck(1, 1, 1, 0)
      // if cache is not available, query to db and save to cache
      resetQueryHistory()
      await dbConnector.query({ text: 'no cache', values: [] })
      // wait 0.01 seconds for redis to update cache
      await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
      strictEqualCheck(0, 1, 1, 1)
      await dbConnector2.query({ text: 'no cache', values: [] })
      strictEqualCheck(0, 2, 1, 1)
      await dbConnector3.query({ text: 'no cache', values: [] })
      strictEqualCheck(1, 2, 1, 1)
      // if redis is not connected, query to db and do not save to cache
      redis.isconnect.returns(false)
      resetQueryHistory()
      await dbConnector.query({ text: 'no cache', values: [] })
      strictEqualCheck(0, 1, 0, 0)
      await dbConnector2.query({ text: 'no cache', values: [] })
      strictEqualCheck(0, 2, 0, 0)
      await dbConnector3.query({ text: 'no cache', values: [] })
      strictEqualCheck(1, 2, 0, 0)
      redis.isconnect.returns(true)
    })

    it('should call select according to logic', async () => {
      resetQueryHistory()
      await dbConnector.select(
        [{ table: 'users' }],
        ['*'],
        { array: [{ field: 'active', comparator: '=', value: true }], is_or: false },
        [{ field: 'created_at', is_asc: false }],
        10,
        2,
        true,
      )
      strictEqualCheck(0, 1, 0, 0)
      await dbConnector.select(
        [{ table: 'users' }],
        ['*'],
        { array: [{ field: 'active', comparator: '=', value: true }], is_or: false },
        [{ field: 'created_at', is_asc: false }],
        10,
        2,
        false,
      )
      // wait 0.01 seconds for redis to update cache
      await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
      strictEqualCheck(0, 2, 1, 1)
    })
  })

  describe('insert, update, upsert, delete', () => {
    it('these calls should all go to masterDB', async () => {
      masterDB.insert.resetHistory()
      await dbConnector.insert('users', [])
      await dbConnector2.insert('users', [])
      await dbConnector3.insert('users', [])
      assert.strictEqual(masterDB.insert.callCount, 3)
      masterDB.update.resetHistory()
      await dbConnector.update('users', [], { array: [{ field: 'id', value: true }], is_or: false })
      await dbConnector2.update('users', [], { array: [{ field: 'id', value: true }], is_or: false })
      await dbConnector3.update('users', [], { array: [{ field: 'id', value: true }], is_or: false })
      assert.strictEqual(masterDB.update.callCount, 3)
      masterDB.upsert.resetHistory()
      await dbConnector.upsert('users', [], [])
      await dbConnector2.upsert('users', [], [])
      await dbConnector3.upsert('users', [], [])
      assert.strictEqual(masterDB.upsert.callCount, 3)
      masterDB.delete.resetHistory()
      await dbConnector.delete('users', { array: [{ field: 'id', value: true }], is_or: false })
      await dbConnector2.delete('users', { array: [{ field: 'id', value: true }], is_or: false })
      await dbConnector3.delete('users', { array: [{ field: 'id', value: true }], is_or: false })
      assert.strictEqual(masterDB.delete.callCount, 3)
    })

    it('build query calls should also go to masterDB', () => {
      masterDB.buildInsertQuery.resetHistory()
      dbConnector.buildInsertQuery('users', [])
      assert(masterDB.buildInsertQuery.calledOnce)
      masterDB.buildUpdateQuery.resetHistory()
      dbConnector.buildUpdateQuery('users', [], { array: [{ field: 'id', value: true }], is_or: false })
      assert(masterDB.buildUpdateQuery.calledOnce)
      masterDB.buildUpsertQuery.resetHistory()
      dbConnector.buildUpsertQuery('users', [], [])
      assert(masterDB.buildUpsertQuery.calledOnce)
      masterDB.buildDeleteQuery.resetHistory()
      dbConnector.buildDeleteQuery('users', { array: [{ field: 'id', value: true }], is_or: false })
      assert(masterDB.buildDeleteQuery.calledOnce)
    })
  })

  describe('buildCache', () => {
    it('should call buildCache for redis', async () => {
      masterDB.isconnect.resetHistory()
      redis.isconnect.resetHistory()
      redis.buildCache.resetHistory()
      await dbConnector.buildCache({ text: 'SELECT * FROM users', values: [] })
      assert.strictEqual(masterDB.isconnect.callCount, 1)
      assert.strictEqual(redis.isconnect.callCount, 1)
      assert.strictEqual(redis.buildCache.callCount, 1)
    })
  })
})
