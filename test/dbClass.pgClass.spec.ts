import assert from 'assert'
import {
  describe, it, before, after,
} from 'mocha'
import sinon from 'ts-sinon'
import { Pool } from 'pg'
import SQLClass from '../src/dbClass' // Adjust the path as needed
import PgClass from '../src/pgClass' // Adjust the path as needed

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
    expected: 'SELECT * FROM users WHERE active = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
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
    expected: 'SELECT u.id, u.name, up.profile_picture, uer.entity FROM users AS u INNER JOIN user_profiles AS up ON u.id = up.user_id AND up.is_deleted = false LEFT JOIN user_entity_relationship AS uer ON u.id = uer.user_id AND uer.is_deleted = true WHERE u.active = $1 OR uer.entity_category = $2',
    values: [true, 'system'],
  },
  {
    table: [{ table: 'users' }],
    fields: ['id', 'name'],
    conditions: { array: [{ field: 'status', value: 'active' }], is_or: false },
    order: [{ field: 'created_at', is_asc: false }, { field: 'name', is_asc: true }],
    limit: 10,
    offset: 0,
    expected: 'SELECT id, name FROM users WHERE status = $1 ORDER BY created_at DESC, name ASC LIMIT $2',
    values: ['active', 10],
  },
  {
    table: [{ table: 'users' }],
    fields: ['id', 'name'],
    conditions: { array: [{ field: 'age', comparator: '<', value: 3 }], is_or: false },
    order: [{ field: 'created_at', is_asc: false }, { field: 'name', is_asc: true }],
    limit: 10,
    offset: 0,
    expected: 'SELECT id, name FROM users WHERE age < $1 ORDER BY created_at DESC, name ASC LIMIT $2',
    values: [3, 10],
  },
  {
    table: [{ table: 'users' }],
    fields: ['*'],
    conditions: { array: [['phone_number', 'IS NULL'], ['email', 'test@test.com'], ['user_posts', '>', 5]], is_or: false },
    expected: 'SELECT * FROM users WHERE phone_number IS NULL AND email = $1 AND user_posts > $2',
    values: ['test@test.com', 5],
  },
  {
    table: [{ table: 'users' }],
    fields: ['*'],
    conditions: { array: [['user_posts', '5']], is_or: false },
    expected: 'SELECT * FROM users WHERE user_posts = $1',
    values: ['5'],
  },
]

describe('SQLClass', () => {
  describe('Static validation methods', () => {
    it('should validate identifiers correctly', () => {
      // Valid identifiers
      const validIdentifiers = ['valid_identifier', 'u.user_id', '*', 'u', 'user_profiles']
      validIdentifiers.forEach((id) => {
        try {
          SQLClass.validateIdentifier(id)
        } catch (e) {
          assert.fail(`Should not throw error on ${id}`)
        }
      })

      // Invalid identifiers
      const invalidIdentifiers = [
        'invalid-identifier',
        'invalid identifier',
        'user; SELECT 1;',
      ]
      invalidIdentifiers.forEach((c) => {
        assert.throws(() => SQLClass.validateIdentifier(c), new Error(`Invalid identifier: ${c}`))
      })
    })

    /* it('should validate comparators correctly', () => {
      // Valid comparators
      const validIdentifiers = ['=', '!=', '<', '<=', '>', '>=', '<>']
      validIdentifiers.forEach((id) => {
        try {
          SQLClass.validateComparator(id)
        } catch (e) {
          assert.fail(`Should not throw error on ${id}`)
        }
      })

      // Invalid comparators
      const invalidIdentifiers = ['===', '!<', '><', '', '!==', '!>', '!>=', '!<=']
      invalidIdentifiers.forEach((c) => {
        assert.throws(() => SQLClass.validateComparator(c), new Error(`Invalid comparator: ${c}`))
      })
    })
    */

    it('should validate values correctly', () => {
      // Valid values
      const validIdentifiers = [123, 'active', true]
      validIdentifiers.forEach((id) => {
        try {
          SQLClass.validateValue(id)
        } catch (e) {
          assert.fail(`Should not throw error on ${id}`)
        }
      })

      // Invalid values
      const invalidIdentifiers = [[], () => { }, undefined]
      invalidIdentifiers.forEach((c) => {
        assert.throws(() => SQLClass.validateValue(c), new Error('Invalid value'))
      })
    })

    it('should validate join types correctly', () => {
      // Valid join types
      const validIdentifiers = ['INNER', 'LEFT', 'RIGHT', 'FULL']
      validIdentifiers.forEach((id) => {
        try {
          SQLClass.validateJoinType(id)
        } catch (e) {
          assert.fail(`Should not throw error on ${id}`)
        }
      })

      // Invalid join types
      const invalidIdentifiers = ['OUTER', 'CROSS', '', 'INNER JOIN']
      invalidIdentifiers.forEach((c) => {
        assert.throws(() => SQLClass.validateJoinType(c), new Error(`Invalid join type: ${c}`))
      })
    })
  })

  const validConfig = {
    client: 'pg',
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
            const pgClassShouldNotWork = new PgClass(c)
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
    let pgClass: PgClass
    let poolStub: sinon.SinonStubbedInstance<Pool>
    let loggerStub: sinon.SinonStubbedInstance<any>
    let clientStub: { [key: string]: any } = {}

    before(() => {
      // Stub the Pool class
      poolStub = sinon.createStubInstance(Pool)

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

      // Create an instance of PgClass with the stubbed Pool
      pgClass = new PgClass({
        client: 'pg',
        endpoint: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'password',
      });
      (pgClass as any).pool = poolStub;
      (pgClass as any).clients = clientStub;
      (pgClass as any).logger = loggerStub

      // Stub the query method to run the special function
      poolStub.connect.callsFake(async () => ({
        release: sinon.stub(),
        removeAllListeners: sinon.stub(),
        query: sinon.stub().callsFake(async () => (
          { rows: [{ id: 1 }], rowsCount: 1 }
        )),
      }))
      poolStub.end.callsFake(async () => ({}))
      poolStub.query.callsFake(async () => ({}))
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should connect to the database', async () => {
      poolStub.connect.resetHistory()
      await pgClass.connect()
      assert(poolStub.connect.calledOnce)
      assert(Object.keys(clientStub).length === 1)
    })

    it('should get a client from the pool', async () => {
      poolStub.connect.resetHistory()
      const client = await pgClass.getRawClient()
      assert(poolStub.connect.calledOnce)
      assert.deepStrictEqual(await client.query(), { rows: [{ id: 1 }], rowsCount: 1 })
    })

    it('should log an error and throw when connection fails', async () => {
      const error = new Error('Connection failed')
      poolStub.connect.rejects(error)
      loggerStub.error.resetHistory()

      await assert.rejects(async () => {
        await pgClass.connect()
      }, (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Failed to connect to database')
        return true
      })
      assert(loggerStub.error.calledWith({ event: 'Pool - connect', err: error }))
    })

    it('should log an error and throw when get raw client fails', async () => {
      const error = new Error('Connection failed')
      poolStub.connect.rejects(error)
      loggerStub.error.resetHistory()

      await assert.rejects(async () => {
        await pgClass.getRawClient()
      }, (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Failed to get db client')
        return true
      })
      assert(loggerStub.error.calledWith({ event: 'Pool - getRawClient', err: error }))
    })

    it('should disconnect from the database', async () => {
      const fakeClient = { release: sinon.stub(), removeAllListeners: sinon.stub() };
      (pgClass as any).clients = { 'client-id': fakeClient }
      poolStub.end.resetHistory()
      await pgClass.disconnect()

      assert(fakeClient.removeAllListeners.calledOnce)
      assert(fakeClient.release.calledOnce)
      assert(poolStub.end.calledOnce)
    })

    it('should log an error and throw when disconnection fails', async () => {
      const error = new Error('Connection failed')
      poolStub.end.rejects(error)
      loggerStub.error.resetHistory()

      await assert.rejects(async () => {
        await pgClass.disconnect()
      }, (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Failed to disconnect from database')
        return true
      })
      assert(loggerStub.error.calledWith({ event: 'Pool - disconnect', err: error }))
    })

    it('should check isconnect to the database', async () => {
      poolStub.query.resetHistory()
      assert(await pgClass.isconnect())
      assert(poolStub.query.calledOnce)

      const error = new Error('Connection failed')
      poolStub.query.rejects(error)
      loggerStub.error.resetHistory()
      assert(!(await pgClass.isconnect()))
      assert(loggerStub.error.calledWith({ event: 'Pool - isconnect', err: error }))
    })

    it('should connect to database when it is not when calling query', async () => {
      poolStub.query.resetHistory()
      poolStub.connect.resetHistory()
      poolStub.connect.callsFake(async () => ({
        release: sinon.stub(), removeAllListeners: sinon.stub(),
      }))
      const error = new Error('Connection failed')
      poolStub.query.rejects(error)
      // the call will do one connect() and still reject (as query is not running)
      await assert.rejects(async () => {
        await pgClass.query({ text: 'SELECT * FROM users', values: [] })
      }, (err: Error) => {
        assert.strictEqual(err.name, 'Error')
        assert.strictEqual(err.message, 'Connection failed')
        return true
      })
      assert(poolStub.connect.calledOnce)
      assert(poolStub.query.callCount === 2)
    })
  })

  describe('validateQuery', () => {
    let pgClass: PgClass
    let poolStub: sinon.SinonStubbedInstance<Pool>

    before(() => {
      // Stub the Pool class
      poolStub = sinon.createStubInstance(Pool)

      // Create an instance of PgClass with the stubbed Pool
      pgClass = new PgClass({
        client: 'pg',
        endpoint: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'password',
      });
      (pgClass as any).pool = poolStub

      // Stub the query method to run the special function
      poolStub.query.callsFake(async (text: any) => {
        if (text === 'EXPLAIN SELECT * FROM users') {
          return
        }
        throw new Error('Invalid SQL query')
      })
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
        await pgClass.validateQuery(query)
      } catch (e) {
        assert.fail('Should not throw error')
      }
      await assert.rejects(
        async () => {
          await pgClass.validateQuery(query2)
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
    const pgClass = new PgClass({
      client: 'pg',
      endpoint: 'localhost',
      port: 5432,
      database: 'test',
      username: 'user',
      password: 'password',
    })
    it('should build a valid SELECT query with conditions, order, limit, and offset', async () => {
      selectCases.forEach((c) => {
        const query = pgClass.buildSelectQuery(
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
            await pgClass.buildSelectQuery(c.table, c.fields)
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
            await pgClass.buildSelectQuery(
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
            await pgClass.buildSelectQuery(
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
            await pgClass.buildSelectQuery(
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
    let pgClass: PgClass
    let poolStub: sinon.SinonStubbedInstance<Pool>

    before(() => {
      // Stub the Pool class
      poolStub = sinon.createStubInstance(Pool)

      // Create an instance of PgClass with the stubbed Pool
      pgClass = new PgClass({
        client: 'pg',
        endpoint: 'localhost',
        port: 5432,
        database: 'test',
        username: 'user',
        password: 'password',
      });
      (pgClass as any).pool = poolStub

      // Stub the query method to run the special function
      poolStub.query.callsFake(async (text: any, values: any) => (
        { rows: [{ id: 1, debug_text: text, debug_values: values }], rowCount: 1 }
      ))
    })

    after(() => {
      // Restore the original methods
      sinon.restore()
    })

    it('should run a SELECT query correctly', async () => {
      await Promise.all(selectCases.map(async (c) => {
        const query = await pgClass.select(
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
          expected: 'INSERT INTO users (name) VALUES ($1) RETURNING *',
          values: ['test'],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30 },
          expected: 'INSERT INTO users (name, age) VALUES ($1, $2) RETURNING *',
          values: ['test', 30],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30, active: true },
          expected: 'INSERT INTO users (name, age, active) VALUES ($1, $2, $3) RETURNING *',
          values: ['test', 30, true],
        },
      ]
      await Promise.all(insertCases.map(async (c) => {
        const query = await pgClass.insert(c.table, c.data)
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
            await pgClass.insert(c.table, c.data)
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
          expected: 'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
          values: ['test', 1],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30 },
          conditions: { array: [{ field: 'id', comparator: '<=', value: 1 }, { field: 'active', comparator: '!=', value: true }], is_or: false },
          expected: 'UPDATE users SET name = $1, age = $2 WHERE id <= $3 AND active != $4 RETURNING *',
          values: ['test', 30, 1, true],
        },
        {
          table: 'users',
          data: { name: 'test', age: 30 },
          conditions: { array: [['id', '<=', 1], ['active', '!=', true]], is_or: false },
          expected: 'UPDATE users SET name = $1, age = $2 WHERE id <= $3 AND active != $4 RETURNING *',
          values: ['test', 30, 1, true],
        },
        {
          table: 'users',
          data: { name: 'test', active: true },
          conditions: { array: [{ field: 'id', comparator: '<>', value: 1 }, { field: 'age', comparator: '>', value: 30 }], is_or: true },
          expected: 'UPDATE users SET name = $1, active = $2 WHERE id <> $3 OR age > $4 RETURNING *',
          values: ['test', true, 1, 30],
        },
      ]
      await Promise.all(updateCases.map(async (c) => {
        const query = await pgClass.update(c.table, c.data, c.conditions)
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
            await pgClass.update(c.table, c.data, c.conditions)
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
          expected: 'INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING *',
          values: [1, 'test'],
        },
        {
          table: 'users',
          indexData: ['id', 'name'],
          data: { id: 1, name: 'test', age: 30 },
          expected: 'INSERT INTO users (id, name, age) VALUES ($1, $2, $3) ON CONFLICT (id, name) DO UPDATE SET age = EXCLUDED.age RETURNING *',
          values: [1, 'test', 30],
        },
        {
          table: 'users',
          indexData: ['id'],
          data: { id: 1, name: 'test', age: 30 },
          expected: 'INSERT INTO users (id, name, age) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age RETURNING *',
          values: [1, 'test', 30],
        },
        {
          table: 'users',
          indexData: ['id'],
          data: {
            id: 1, name: 'test', age: 30, active: true,
          },
          expected: 'INSERT INTO users (id, name, age, active) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age, active = EXCLUDED.active RETURNING *',
          values: [1, 'test', 30, true],
        },
      ]
      await Promise.all(upsertCases.map(async (c) => {
        const query = await pgClass.upsert(c.table, c.indexData, c.data)
        assert.equal(query.rows[0].debug_text, c.expected)
        assert.deepEqual(query.rows[0].debug_values, c.values)
        assert.equal(query.count, 1)
      }))
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
            await pgClass.upsert(c.table, c.indexData, c.data)
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

    it('should run a DELETE query correctly', async () => {
      const deleteCases = [
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '=', value: 1 }], is_or: false },
          expected: 'DELETE FROM users WHERE id = $1 RETURNING *',
          values: [1],
        },
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '<=', value: 1 }, { field: 'active', comparator: '!=', value: true }], is_or: false },
          expected: 'DELETE FROM users WHERE id <= $1 AND active != $2 RETURNING *',
          values: [1, true],
        },
        {
          table: 'users',
          conditions: { array: [{ field: 'id', comparator: '<>', value: 1 }, { field: 'age', comparator: '>', value: 30 }], is_or: true },
          expected: 'DELETE FROM users WHERE id <> $1 OR age > $2 RETURNING *',
          values: [1, 30],
        },
      ]
      await Promise.all(deleteCases.map(async (c) => {
        const query = await pgClass.delete(c.table, c.conditions)
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
            await pgClass.delete(c.table, c.conditions)
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
