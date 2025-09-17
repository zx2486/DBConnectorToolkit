import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import proxyquire from 'proxyquire'
import SQLite3Class from '../src/sqlite3Class'

describe('SQLite3Class', () => {
  const validConfig = {
    client: 'sqlite3',
    endpoint: ':memory:',
  }
  describe('Class constructor Throw error correctly', () => {
    it('throw error correctly', async () => {
      const invalidConfigs = [
        { ...validConfig, client: 'notpg' },
        { ...validConfig, endpoint: '' },
      ]
      await Promise.all(invalidConfigs.map(async (c) => {
        await assert.rejects(
          async () => {
            const SQLiteClassShouldNotWork = new SQLite3Class(c)
            assert.fail(new Error(`should throw error but did not ${c}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, 'Invalid DB config')
            return true
          },
        )
      }))
    })
  })

  describe('connect, disconnect, isconnect', () => {
    let sqlite3Class: SQLite3Class
    let loggerStub: sinon.SinonStubbedInstance<any>
    let poolStub: sinon.SinonStubbedInstance<any>

    before(() => {
      // Stub the logger
      loggerStub = {
        error: sinon.stub(),
        info: sinon.stub(),
        createLogger: sinon.stub().returns({
          error: sinon.stub(),
          info: sinon.stub(),
        }),
      }

      poolStub = {
        all: sinon.stub().callsFake((sql: string, params: any[], callback: Function) => {
          if (sql === 'SELECT 1') {
            callback(null, [{ id: 1 }])
          } else {
            callback(new Error('Query failed'), null)
          }
        }),
        close: sinon.stub().callsFake((callback: Function) => {
          callback(null)
        }),
        end: sinon.stub(),
      }

      // Create an instance with the stubbed client
      const SQLite3ClassModule = proxyquire('../src/sqlite3Class', {
        sqlite3: {
          Database: sinon.stub().callsFake(() => poolStub),
        },
      }).default
      sqlite3Class = new SQLite3ClassModule({
        ...validConfig,
      });
      (sqlite3Class as any).logger = loggerStub
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should connect to the database', async () => {
      try {
        await sqlite3Class.connect()
      } catch (err) {
        assert.fail(new Error(`should not throw error but got ${err}`))
      }
    })

    it('should get back the client on getRawClient', async () => {
      const client = await sqlite3Class.getRawClient()
      assert.deepStrictEqual(await client.query('SELECT 1'), [{ id: 1 }])
    })

    it('should disconnect from the database', async () => {
      poolStub.close.resetHistory()
      await sqlite3Class.disconnect()
      assert(poolStub.close.calledOnce)
    })

    it('should able to connect again after disconnect and check isconnect to the database', async () => {
      await sqlite3Class.connect()
      poolStub.all.resetHistory()
      assert(await sqlite3Class.isconnect())
      assert(poolStub.all.calledOnce)
    })
  })

  describe('transaction', () => {
    let sqlite3Class: SQLite3Class
    let loggerStub: sinon.SinonStubbedInstance<any>
    let poolStub: sinon.SinonStubbedInstance<any>

    before(() => {
      // Stub the logger
      loggerStub = {
        error: sinon.stub(),
        info: sinon.stub(),
        createLogger: sinon.stub().returns({
          error: sinon.stub(),
          info: sinon.stub(),
        }),
      }

      poolStub = {
        all: sinon.stub().callsFake((sql: string, params: any[], callback: Function) => {
          if (sql === 'SELECT 1') {
            callback(null, [{ 1: 1 }])
          } else {
            callback(new Error('Query failed'), null)
          }
        }),
        close: sinon.stub().callsFake((callback: Function) => {
          callback(null)
        }),
        end: sinon.stub(),
      }

      // Create an instance with the stubbed client
      const SQLite3ClassModule = proxyquire('../src/sqlite3Class', {
        sqlite3: {
          Database: sinon.stub().callsFake(() => poolStub),
        },
      }).default
      sqlite3Class = new SQLite3ClassModule({
        ...validConfig,
      });
      (sqlite3Class as any).logger = loggerStub
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should run a transaction successfully', async () => {
      try {
        poolStub.all.resetHistory()
        await sqlite3Class.connect()
        const result = await sqlite3Class.transaction([
          async (_prevResult, _client) => {
            const rows = await _client.query('SELECT 1', [])
            return { rows, count: rows.length, ttl: 1 }
          },
          async (prevResult, _client) => {
            const rows = await _client.query('SELECT 1', [])
            return {
              rows: prevResult.rows.concat(rows),
              count: prevResult.count + rows.length,
              ttl: 1,
            }
          },
        ])
        assert.strictEqual(result.count, 2)
        assert.strictEqual(result.rows.length, 2)
        assert(poolStub.all.calledTwice)
      } catch (err) {
        assert.fail(new Error(`should not throw error but got ${err}`))
      }
    })
  })
})
