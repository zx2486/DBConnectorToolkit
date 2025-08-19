import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import { Pool, PoolConnection } from 'mariadb'
import proxyquire from 'proxyquire'
import MariaClass from '../src/mariaClass'

const selectCases = [
  {
    table: [{ table: 'users' }],
    fields: ['id', 'name'],
    expected: 'SELECT id, name FROM users',
    values: [],
  },
  {
    table: [{ table: 'users' }],
    fields: ['*'],
    conditions: { array: [{ field: 'active', comparator: '=', value: true }], is_or: false },
    order: [{ field: 'created_at', is_asc: false }],
    limit: 10,
    offset: 2,
    expected: 'SELECT * FROM users WHERE active = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    values: [true, 10, 2],
  },
  {
    table: [{ table: 'users', name: 'u' }, {
      table: 'user_profiles',
      name: 'up',
      join_type: 'INNER',
      on: [{ left: 'u.id', right: 'up.user_id' }, { left: 'up.is_deleted', right: 'false' }],
    }, {
      table: 'user_entity_relationship',
      name: 'uer',
      join_type: 'LEFT',
      on: [{ left: 'u.id', right: 'uer.user_id' }, { left: 'uer.is_deleted', right: 'true' }],
    }],
    fields: ['u.id', 'u.name', 'up.profile_picture', 'uer.entity'],
    conditions: { array: [{ field: 'u.active', comparator: '=', value: true }, { field: 'uer.entity_category', comparator: '=', value: 'system' }], is_or: true },
    expected: 'SELECT u.id, u.name, up.profile_picture, uer.entity FROM users AS u INNER JOIN user_profiles AS up ON u.id = up.user_id AND up.is_deleted = false LEFT JOIN user_entity_relationship AS uer ON u.id = uer.user_id AND uer.is_deleted = true WHERE u.active = ? OR uer.entity_category = ?',
    values: [true, 'system'],
  },
  {
    table: [{ table: 'users' }],
    fields: ['id', 'name'],
    conditions: { array: [{ field: 'status', value: 'active' }], is_or: false },
    order: [{ field: 'created_at', is_asc: false }, { field: 'name', is_asc: true }],
    limit: 10,
    offset: 0,
    expected: 'SELECT id, name FROM users WHERE status = ? ORDER BY created_at DESC, name ASC LIMIT ?',
    values: ['active', 10],
  },
  {
    table: [{ table: 'users' }],
    fields: ['id', 'name'],
    conditions: { array: [{ field: 'age', comparator: '<', value: 3 }], is_or: false },
    order: [{ field: 'created_at', is_asc: false }, { field: 'name', is_asc: true }],
    limit: 10,
    offset: 0,
    expected: 'SELECT id, name FROM users WHERE age < ? ORDER BY created_at DESC, name ASC LIMIT ?',
    values: [3, 10],
  },
  {
    table: [{ table: 'users' }],
    fields: ['*'],
    conditions: { array: [['phone_number', 'IS NULL'], ['email', 'test@test.com'], ['user_posts', '>', 5]], is_or: false },
    expected: 'SELECT * FROM users WHERE phone_number IS NULL AND email = ? AND user_posts > ?',
    values: ['test@test.com', 5],
  },
  {
    table: [{ table: 'users' }],
    fields: ['*'],
    conditions: { array: [['user_posts', '5']], is_or: false },
    expected: 'SELECT * FROM users WHERE user_posts = ?',
    values: ['5'],
  },
]

describe('MariaClass', () => {
  const validConfig = {
    client: 'mariadb',
    endpoint: 'localhost',
    port: 5432,
    database: 'test',
    username: 'user',
    password: 'password',
  }
  describe('Class constructor Throw error correctly', () => {
    it('throw error correctly', async () => {
      const invalidConfigs = [
        { ...validConfig, client: 'notpg' },
        { ...validConfig, endpoint: '' },
        { ...validConfig, port: 0 },
        { ...validConfig, database: '' },
        { ...validConfig, username: '' },
        { ...validConfig, password: '' },
      ]
      await Promise.all(invalidConfigs.map(async (c) => {
        await assert.rejects(
          async () => {
            const MariaClassShouldNotWork = new MariaClass(c)
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
    let mariaClass: MariaClass
    let poolStub: sinon.SinonStubbedInstance<Pool>
    let poolConnectionStub: sinon.SinonStubbedInstance<PoolConnection>
    let loggerStub: sinon.SinonStubbedInstance<any>
    let clientStub: { [key: string]: any } = {}

    before(() => {
      // Stub the query method to run the special function
      poolConnectionStub = {
        beginTransaction: sinon.stub().callsFake(async () => { }),
        commit: sinon.stub().callsFake(async () => { }),
        rollback: sinon.stub().callsFake(async () => { }),
        release: sinon.stub().callsFake(async () => { }),
        query: sinon.stub().callsFake(async () => (
          [{ id: 1 }]
        )),
      } as any
      poolStub = {
        getConnection: sinon.stub().callsFake(async () => poolConnectionStub as any),
        end: sinon.stub().callsFake(async () => { }),
        query: sinon.stub().callsFake(async () => ({})),
        totalConnections: sinon.stub().callsFake(() => 1),
        on: sinon.stub().callsFake(() => poolStub),
      } as any

      // Stub the logger
      loggerStub = {
        error: sinon.stub(),
        info: sinon.stub(),
        createLogger: sinon.stub().returns({
          error: sinon.stub(),
          info: sinon.stub(),
        }),
      }
      clientStub = []

      // Create an instance of MariaClass with the stubbed Pool
      const MariaClassModule = proxyquire('../src/mariaClass', {
        mariadb: {
          createPool: sinon.stub().callsFake(() => poolStub),
        },
      }).default
      mariaClass = new MariaClassModule({
        client: 'mariadb',
        endpoint: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'password',
      });
      (mariaClass as any).pool = poolStub;
      (mariaClass as any).clients = clientStub;
      (mariaClass as any).logger = loggerStub
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should connect to the database', async () => {
      // poolStub.totalConnections.resetHistory()
      await mariaClass.connect()
      // assert(poolStub.totalConnections.calledOnce)
      assert(Object.keys(clientStub).length === 0)
    })

    it('should get a client from the pool', async () => {
      poolStub.getConnection.resetHistory()
      const client = await mariaClass.getRawClient()
      assert(poolStub.getConnection.calledOnce)
      assert.deepStrictEqual(await client.query(), [{ id: 1 }])
    })

    it('should log an error and throw when get raw client fails', async () => {
      const error = new Error('Connection failed')
      poolStub.getConnection.rejects(error)
      loggerStub.error.resetHistory()

      await assert.rejects(async () => {
        await mariaClass.getRawClient()
      }, (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Failed to get db client')
        return true
      })
    })

    it('should disconnect from the database', async () => {
      const fakeClient = { release: sinon.stub() };
      (mariaClass as any).clients = { 'client-id': fakeClient }
      poolStub.end.resetHistory()
      await mariaClass.disconnect()

      assert(fakeClient.release.calledOnce)
      assert(poolStub.end.calledOnce)
    })

    it('should log an error and throw when disconnection fails', async () => {
      const error = new Error('Connection failed')
      poolStub.end.rejects(error)
      loggerStub.error.resetHistory()

      await assert.rejects(async () => {
        await mariaClass.disconnect()
      }, (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Failed to disconnect from database')
        return true
      })
    })

    it('should check isconnect to the database', async () => {
      poolStub.query.resetHistory()
      assert(await mariaClass.isconnect())
      assert(poolStub.query.calledOnce)

      const error = new Error('Connection failed')
      poolStub.query.rejects(error)
      loggerStub.error.resetHistory()
      assert(!(await mariaClass.isconnect()))
      assert(loggerStub.error.calledWith({ event: 'Pool - isconnect', err: error }))
    })
  })

  describe('validateQuery', () => {
    let mariaClass: MariaClass
    let poolStub: sinon.SinonStubbedInstance<Pool>

    before(() => {
      // Stub the query method to run the special function
      poolStub = {
        query: sinon.stub().callsFake(async (text: any) => {
          if (text === 'EXPLAIN SELECT * FROM users') {
            return
          }
          throw new Error('Invalid SQL query')
        }),
        on: sinon.stub().callsFake(() => poolStub),
      } as any

      // Create an instance of MariaClass with the stubbed Pool
      const MariaClassModule = proxyquire('../src/mariaClass', {
        mariadb: {
          createPool: sinon.stub().callsFake(() => poolStub),
        },
      }).default
      mariaClass = new MariaClassModule({
        client: 'mariadb',
        endpoint: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'password',
      });
      (MariaClass as any).pool = poolStub
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should validate a query correctly', async () => {
      const query = {
        text: 'SELECT * FROM users',
        values: [true],
      }
      const query2 = {
        text: 'This is not a SQL statement',
        values: [true],
      }
      try {
        await mariaClass.validateQuery(query)
      } catch (e) {
        assert.fail('Should not throw error')
      }
      await assert.rejects(
        async () => {
          await mariaClass.validateQuery(query2)
          assert.fail(new Error('should throw error but did not'))
        },
        (err: Error) => {
          assert.strictEqual(err.name, 'Error')
          assert.strictEqual(err.message, 'Invalid SQL query')
          return true
        },
      )
    })
  })

  describe('buildSelectQuery', () => {
    const defaultPool = {
      on: sinon.stub().callsFake(() => defaultPool),
    }
    const MariaClassModule = proxyquire('../src/mariaClass', {
      mariadb: {
        createPool: sinon.stub().callsFake(() => defaultPool),
      },
    }).default
    const mariaClass = new MariaClassModule({
      client: 'mariadb',
      endpoint: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'password',
    })
    it('should build a valid SELECT query with conditions, order, limit, and offset', async () => {
      selectCases.forEach((c) => {
        const query = mariaClass.buildSelectQuery(
          c.table,
          c.fields,
          c.conditions,
          c.order,
          c.limit,
          c.offset,
        )
        assert.equal(query.text, c.expected)
        assert.deepEqual(query.values, c.values)
      })
    })

    it('should throw an error for invalid table or fields', async () => {
      const cases = [
        {
          table: [],
          fields: ['id', 'name'],
          errMsg: 'Invalid query',
        },
        {
          table: [{ table: 'users' }],
          fields: [],
          errMsg: 'Invalid query',
        },
        {
          table: [{ table: 'users!' }],
          fields: ['*'],
          errMsg: 'Invalid identifier: users!',
        },
        {
          table: [{ table: 'users; Select 1;' }],
          fields: ['id', 'name'],
          errMsg: 'Invalid identifier: users; Select 1;',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id, active', 'name'],
          errMsg: 'Invalid identifier: id, active',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name; select 1;'],
          errMsg: 'Invalid identifier: name; select 1;',
        },
        {
          table: [{ table: 'users' }, { table: 'user_profiles' }],
          fields: ['id', 'name'],
          errMsg: 'Invalid query: TABLES without JOIN and ON',
        },
        {
          table: [{ table: 'users' }, {
            table: 'user_profiles',
            join_type: '',
            on: [{ left: 'u.id', right: 'uer.user_id' }, { left: 'uer.is_deleted', right: 'true' }],
          }],
          fields: ['id', 'name'],
          errMsg: 'Invalid query: TABLES without JOIN and ON',
        },
        {
          table: [{ table: 'users' }, {
            table: 'user_profiles',
            join_type: 'OUTER',
            on: [{ left: 'u.id', right: 'uer.user_id' }, { left: 'uer.is_deleted', right: 'true' }],
          }],
          fields: ['id', 'name'],
          errMsg: 'Invalid join type: OUTER',
        },
        {
          table: [{ table: 'users' }, {
            table: 'user_profiles',
            join_type: 'OUTER',
            on: [],
          }],
          fields: ['id', 'name'],
          errMsg: 'Invalid query: TABLES without JOIN and ON',
        },
        {
          table: [{ table: 'users' }, {
            table: 'user_profiles',
            join_type: 'LEFT',
            on: [{ left: 'u.id', right: 'uer.user_id; SELECT 1;' }],
          }],
          fields: ['id', 'name'],
          errMsg: 'Invalid identifier: uer.user_id; SELECT 1;',
        },
        {
          table: [{ table: 'users' }, {
            table: 'user_profiles',
            join_type: 'LEFT',
            on: [{ left: 'u.id; SELECT 1', right: 'uer.user_id' }],
          }],
          fields: ['id', 'name'],
          errMsg: 'Invalid identifier: u.id; SELECT 1',
        },
      ]
      await Promise.all(cases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.buildSelectQuery(c.table, c.fields)
            assert.fail(new Error(`should throw error but did not ${c.errMsg}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })

    it('should throw error for invalid conditions', async () => {
      const cases = [
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          conditions: { array: [{ field: 'age; select 1', value: true }], is_or: true },
          errMsg: 'Invalid identifier: age; select 1',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          conditions: { array: [{ field: 'active', comparator: '*', value: true }, { field: 'age', comparator: '<', value: 3 }], is_or: true },
          errMsg: 'Invalid comparator: *',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          conditions: { array: [{ field: 'active', comparator: '=', value: true }, { field: 'age', comparator: '*', value: { a: 1 } }], is_or: false },
          errMsg: 'Invalid comparator: *',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          conditions: { array: [{ field: 'age', value: [] }], is_or: true },
          errMsg: 'Invalid value',
        },
      ]
      await Promise.all(cases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.buildSelectQuery(
              c.table,
              c.fields,
              c.conditions,
            )
            assert.fail(new Error(`should throw error but did not ${c.errMsg}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })

    it('Should throw error for invalid order', async () => {
      const cases = [
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          order: [{ field: 'age; select 1', is_asc: true }],
          errMsg: 'Invalid identifier: age; select 1',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          order: [{ field: 'age', is_asc: false }, { field: 'name; select 1', is_asc: true }],
          errMsg: 'Invalid identifier: name; select 1',
        },
      ]
      await Promise.all(cases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.buildSelectQuery(
              c.table,
              c.fields,
              undefined,
              c.order,
            )
            assert.fail(new Error(`should throw error but did not ${c.errMsg}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })

    it('Should throw error for invalid limit or offset', async () => {
      const cases = [
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          limit: 3.5,
          errMsg: 'Invalid limit value',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          offset: 43.2,
          errMsg: 'Invalid offset value',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          limit: -1,
          errMsg: 'Invalid limit value',
        },
        {
          table: [{ table: 'users' }],
          fields: ['id', 'name'],
          offset: -1,
          errMsg: 'Invalid offset value',
        },
      ]
      await Promise.all(cases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.buildSelectQuery(
              c.table,
              c.fields,
              undefined,
              undefined,
              c.limit,
              c.offset,
            )
            assert.fail(new Error(`should throw error but did not ${c.errMsg}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })
  })

  describe('select, insert, update, upsert', () => {
    let mariaClass: MariaClass
    let poolStub: sinon.SinonStubbedInstance<Pool>
    let transactionLog: any[] = []
    let releaseCount = 0
    let isConnectionCommit = false

    before(() => {
      // Stub the query method to run the special function
      poolStub = {
        query: sinon.stub().callsFake(async (text: any, values: any) => (
          [{ id: 1, debug_text: text, debug_values: values }]
        )),
        on: sinon.stub().callsFake(() => poolStub),
        getConnection: sinon.stub().callsFake(() => ({
          beginTransaction: sinon.stub().callsFake(async () => {
            transactionLog = []
          }),
          commit: sinon.stub().callsFake(async () => {
            isConnectionCommit = true
          }),
          rollback: sinon.stub().callsFake(async () => { }),
          release: sinon.stub().callsFake(async () => {
            releaseCount += 1
          }),
          // this stub option should save all the queries in transactionLog
          // and return the connection as a result
          query: sinon.stub().callsFake(async (text: string, values: any) => {
            transactionLog.push({ text, values })
            return transactionLog
          }),
        })),
      } as any

      // Create an instance of MariaClass with the stubbed Pool
      const MariaClassModule = proxyquire('../src/mariaClass', {
        mariadb: {
          createPool: sinon.stub().callsFake(() => poolStub),
        },
      }).default
      mariaClass = new MariaClassModule({
        client: 'mariadb',
        endpoint: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'password',
      });
      (MariaClass as any).pool = poolStub
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should run a SELECT query correctly', async () => {
      await Promise.all(selectCases.map(async (c) => {
        const query = await mariaClass.select(
          c.table,
          c.fields,
          c.conditions,
          c.order,
          c.limit,
          c.offset,
        )
        assert.equal(query.rows[0].debug_text, c.expected)
        assert.deepEqual(query.rows[0].debug_values, c.values)
        assert.equal(query.count, 1)
      }))
    })

    it('should run an INSERT query correctly', async () => {
      const insertCases = [
        {
          table: 'users',
          data: { name: 'test' },
          expected: 'INSERT INTO users (name) VALUES (?) RETURNING *',
          values: ['test'],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30 },
          expected: 'INSERT INTO users (name, age) VALUES (?, ?) RETURNING *',
          values: ['test', 30],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30, active: true },
          expected: 'INSERT INTO users (name, age, active) VALUES (?, ?, ?) RETURNING *',
          values: ['test', 30, true],
        },
      ]
      await Promise.all(insertCases.map(async (c) => {
        const query = await mariaClass.insert(c.table, c.data)
        assert.equal(query.rows[0].debug_text, c.expected)
        assert.deepEqual(query.rows[0].debug_values, c.values)
        assert.equal(query.count, 1)
      }))
      const failedCases = [
        {
          table: '',
          data: { name: 'test' },
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          data: [],
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          data: { name: 'test', age: 30, active: ['a', 1] },
          errMsg: 'Invalid value',
        },
        {
          table: 'users',
          data: { name: 'test', age: 30, 'active; SELECT 1;': true },
          errMsg: 'Invalid identifier: active; SELECT 1;',
        },
      ]
      await Promise.all(failedCases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.insert(c.table, c.data)
            assert.fail(new Error('should throw error but did not'))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })

    it('should run an UPDATE query correctly', async () => {
      const updateCases = [
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          expected: 'UPDATE users SET name = ? WHERE id = ?',
          values: ['test', 1],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30 },
          conditions: { array: [{ field: 'id', comparator: '<=', value: 1 }, { field: 'active', comparator: '!=', value: true }], is_or: false },
          expected: 'UPDATE users SET name = ?, age = ? WHERE id <= ? AND active != ?',
          values: ['test', 30, 1, true],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30 },
          conditions: { array: [['id', '<=', 1], ['active', '!=', true]], is_or: false },
          expected: 'UPDATE users SET name = ?, age = ? WHERE id <= ? AND active != ?',
          values: ['test', 30, 1, true],
        },
        {
          table: 'users',
          data: { name: 'test', active: true },
          conditions: { array: [{ field: 'id', comparator: '<>', value: 1 }, { field: 'age', comparator: '>', value: 30 }], is_or: true },
          expected: 'UPDATE users SET name = ?, active = ? WHERE id <> ? OR age > ?',
          values: ['test', true, 1, 30],
        },
      ]
      await Promise.all(updateCases.map(async (c) => {
        const query = await mariaClass.update(c.table, c.data, c.conditions)
        assert.equal(query.rows[0].debug_text, c.expected)
        assert.deepEqual(query.rows[0].debug_values, c.values)
        assert.equal(query.count, 1)
      }))
      const failedCases = [
        {
          table: '',
          data: { name: 'test' },
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          data: [],
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          data: { name: 'test', age: 30, active: [{ a: 1 }] },
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid value',
        },
        {
          table: 'users',
          data: { name: 'test', age: 30, 'active; SELECT 1;': true },
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid identifier: active; SELECT 1;',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [{ field: 'id', comparator: '===', value: 1 }], is_or: false },
          errMsg: 'Invalid comparator: ===',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [], is_or: false },
          errMsg: 'Invalid conditions',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }, { field: '', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid identifier: ',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['', '<=', 1], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid identifier: ',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [[5, '<=', 1], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid identifier: 5',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['id', '!!', 1], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid comparator: !!',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['id', '>=', []], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid value',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['id;', '>=', 'value'], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid identifier: id;',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['id', '>=', 'value', 'more'], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid condition: ["id",">=","value","more"]',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['id'], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid condition: ["id"]',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['id', []], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid value',
        },
        {
          table: 'users',
          data: { name: 'test' },
          conditions: { array: [['', 5], ['active', '!=', true]], is_or: false },
          errMsg: 'Invalid identifier: ',
        },
      ]
      await Promise.all(failedCases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.update(c.table, c.data, c.conditions)
            assert.fail(new Error('should throw error but did not'))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })

    it('should run a UPSERT query correctly', async () => {
      const upsertCases = [
        {
          table: 'users',
          indexData: ['id'],
          data: { id: 1, name: 'test' },
          expected: [
            { text: 'UPDATE users SET name = ? WHERE id = ?;', values: ['test', 1] },
            { text: 'INSERT INTO users (id, name) SELECT ?, ? FROM dual WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ?);', values: [1, 'test', 1] },
            { text: 'SELECT * FROM users WHERE id = ?;', values: [1] },
          ],
        },
        {
          table: 'users',
          indexData: ['id', 'name'],
          data: { id: 1, name: 'test', age: 30 },
          expected: [
            { text: 'UPDATE users SET age = ? WHERE id = ? AND name = ?;', values: [30, 1, 'test'] },
            { text: 'INSERT INTO users (id, name, age) SELECT ?, ?, ? FROM dual WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ? AND name = ?);', values: [1, 'test', 30, 1, 'test'] },
            { text: 'SELECT * FROM users WHERE id = ? AND name = ?;', values: [1, 'test'] },
          ],
        },
        {
          table: 'users',
          indexData: ['id'],
          data: { id: 1, name: 'test', age: 30 },
          expected: [
            { text: 'UPDATE users SET name = ?, age = ? WHERE id = ?;', values: ['test', 30, 1] },
            { text: 'INSERT INTO users (id, name, age) SELECT ?, ?, ? FROM dual WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ?);', values: [1, 'test', 30, 1] },
            { text: 'SELECT * FROM users WHERE id = ?;', values: [1] },
          ],
        },
        {
          table: 'users',
          indexData: ['id'],
          data: {
            id: 1, name: 'test', age: 30, active: true,
          },
          expected: [
            { text: 'UPDATE users SET name = ?, age = ?, active = ? WHERE id = ?;', values: ['test', 30, true, 1] },
            { text: 'INSERT INTO users (id, name, age, active) SELECT ?, ?, ?, ? FROM dual WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = ?);', values: [1, 'test', 30, true, 1] },
            { text: 'SELECT * FROM users WHERE id = ?;', values: [1] },
          ],
        },
      ]
      await upsertCases.reduce(async (accPromise, c) => {
        await accPromise
        releaseCount = 0
        isConnectionCommit = false
        const query = await mariaClass.upsert(c.table, c.indexData, c.data)
        assert.equal(releaseCount, 1)
        assert.equal(isConnectionCommit, true)
        assert.equal(query.count, 3)
        assert.equal(query.ttl, undefined)
        assert.equal(query.rows.length, 3)
        c.expected.forEach((expectedQuery, index) => {
          assert.equal(query.rows[index].text, expectedQuery.text)
          assert.deepEqual(query.rows[index].values, expectedQuery.values)
        })
      }, Promise.resolve())
      const failedCases = [
        {
          table: '',
          indexData: ['id'],
          data: { id: 1, name: 'test' },
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          indexData: [],
          data: { id: 1, name: 'test' },
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          indexData: ['id'],
          data: [],
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          indexData: ['id'],
          data: {
            id: 1, name: 'test', age: 30, active: [{ a: 1 }],
          },
          errMsg: 'Invalid value',
        },
        {
          table: 'users',
          indexData: ['id'],
          data: {
            id: 1, name: 'test', age: 30, 'active; SELECT 1;': true,
          },
          errMsg: 'Invalid identifier: active; SELECT 1;',
        },
        {
          table: 'users',
          indexData: ['id'],
          data: { id2: 1, name: 'test' },
          errMsg: 'Index field id not found in data fields',
        },
        {
          table: 'users',
          indexData: ['id'],
          data: { id: 1 },
          errMsg: 'No data fields to update',
        },
      ]
      await Promise.all(failedCases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.upsert(c.table, c.indexData, c.data)
            assert.fail(new Error(`should throw error but did not ${c.errMsg}`))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })

    it('should throw error when calling buildUpsertQuery', async () => {
      await assert.rejects(
        async () => {
          await mariaClass.buildUpsertQuery('users', ['id'], { id: 1, name: 'test' })
          assert.fail(new Error('should throw error but did not'))
        },
        (err: Error) => {
          assert.strictEqual(err.name, 'Error')
          assert.strictEqual(err.message, 'buildUpsertQuery is not supported in MariaClass, use buildUpsertQueries instead')
          return true
        },
      )
    })

    it('should run a DELETE query correctly', async () => {
      const deleteCases = [
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          expected: 'DELETE FROM users WHERE id = ? RETURNING *',
          values: [1],
        },
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '<=', value: 1 }, { field: 'active', comparator: '!=', value: true }], is_or: false },
          expected: 'DELETE FROM users WHERE id <= ? AND active != ? RETURNING *',
          values: [1, true],
        },
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '<>', value: 1 }, { field: 'age', comparator: '>', value: 30 }], is_or: true },
          expected: 'DELETE FROM users WHERE id <> ? OR age > ? RETURNING *',
          values: [1, 30],
        },
      ]
      await Promise.all(deleteCases.map(async (c) => {
        const query = await mariaClass.delete(c.table, c.conditions)
        assert.equal(query.rows[0].debug_text, c.expected)
        assert.deepEqual(query.rows[0].debug_values, c.values)
        assert.equal(query.count, 1)
      }))
      const failedCases = [
        {
          table: '',
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid query',
        },
        {
          table: 'users',
          conditions: { array: [], is_or: false },
          errMsg: 'Invalid conditions',
        },
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '===', value: 1 }], is_or: false },
          errMsg: 'Invalid comparator: ===',
        },
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }, { field: '2e', comparator: '=', value: 1 }], is_or: false },
          errMsg: 'Invalid identifier: 2e',
        },
      ]
      await Promise.all(failedCases.map(async (c) => {
        await assert.rejects(
          async () => {
            await mariaClass.delete(c.table, c.conditions)
            assert.fail(new Error('should throw error but did not'))
          },
          (err: Error) => {
            assert.strictEqual(err.name, 'Error')
            assert.strictEqual(err.message, c.errMsg)
            return true
          },
        )
      }))
    })
  })
})
