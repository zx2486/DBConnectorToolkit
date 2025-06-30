# DBConnectorToolkit
This module provides an integrated tool to connect database under different settings, single db, master with read replica, with redis for caching, and allow using message queue to centralize db writes requests.
The main purpose is to reduce code changes on application with growing traffic and upgrading in infra.

## Installation
```bash
# Include installation commands here
npm install dbconnectortoolkit
```

## Sample use case
Suppose you have a postgres database (web) and would like to select data from it.
```typescript
const dbConnector = require('../../../DBConnectorToolkit/dist').default;

const masterDBConfig = {
  client: 'pg',
  endpoint: 'localhost',
  port: 5432,
  username: 'your_username',
  password: 'your_password',
  database: 'web',
}
const dbConnector = dbConnector(masterDBConfig)
try {
    await dbConnector.connect()
    // Select all data from the users table
    const result = await dbConnector.select(
        [{ table: 'users' }],
        ['*']
    )
    console.log('Data from users table:', result)
    // also have insert, update, upsert, delete methods and query method for raw queries
} catch (err) {
    // throw when database cannot login or something wrong with the query
    console.error('Error:', err)
} finally {
    await dbConnector.disconnect()
}
```

Now suppose your application should only have 1-10 concurrent connections to database (so it will not blow up) and they are managed by a pool
```typescript
const masterDBConfig2 = {
    ...masterDBConfig,
    minConnection: 1,
    maxConnection: 10
}
```
Done.

Now your application is getting great, your lead asks you to use replica database for read queries. Instead of rewriting lots of SQL query code to use slave DB client, all you need is
```typescript
const replicaDBConfig = [
    {
    ...
    },...
]
db = dbConnector(masterDBConfig, replicaDBConfig);
```
All select queries will go to replica and write queries will go to master. No other code change is needed.

Now the traffic is even higher, redis is introduced as cache layer. How many code changes?
```typescript
const cacheConfig = {
    client: 'ioredis',
    url: 'localhost@6379',
    dbIndex: 1, // database index, default is 0
    cacheHeader: 'dbCache'
}
db = dbConnector(masterDBConfig, replicaDBConfig, cacheConfig);
```
Done, no other code change is needed. All read query results will be cached in redis.
The key in redis will be dbCache:${sha256 hash of the raw query}

If data should come from database instead of cache, set _getLatest to true.

When one day the traffic is so high that the backend server is broken into two layers: 
1) Multiple API servers which cannot touch master database
2) Some cron jobs or processing nodes or matching engines which creates db writes
3) All db write requests will be sent as messages for a centralized node to handle and write to master database (and updating cache if needed)

You can still reuse the whole server code as API server with only one change:
```typescript
const kafkaConfig = {
  client: 'kafka',
  appName: 'web-two-layer',
  brokerList: ['localhost:9092'],
  dbTopic: 'writing_db_topic',
}
// There is no master here
db = dbConnector(replicaDBConfig[0], replicaDBConfig, redisConfig, kafkaConfig);
```
All db write requests will be sent to kafka under topic 'writing_db_topic'. All db reads will still be handled by cache / read replica

## Running queries
For details, please read the documentations.

The most basic one, running raw queries:
```typescript
/**
 * run this query and return the result
 * @param _query: parameterized query 
 * {
    text: string,
    values: any[]
    }
    for example, { text: 'SELECT id, username FROM users WHERE age > $1 AND status = $2 ORDER BY modified DESC', values: [18,true] }
 * @param _isWrite, default is false, true if the query should be handled by master db. Otherwise replica db and cache are preferred.
 * @param _getLatest, default is false, true means the query result will not come from cache
 * @returns 
 */
query(_query: Query, _isWrite?: boolean, _getLatest?: boolean): Promise<QueryResult>
```

Five different methods, select, insert, update, upsert, delete. 

All write methods will return * at the end
```typescript
select(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number,
    _getLatest?: boolean
  ): Promise<QueryResult>
// example 1: 'SELECT id, name FROM users'
await select([{ table: 'users' }],['id', 'name'])
/* example 2: 'SELECT u.id, u.name, up.profile_picture, uer.entity FROM users AS u 
INNER JOIN user_profiles AS up ON u.id = up.user_id AND up.is_deleted = false 
LEFT JOIN user_entity_relationship AS uer ON u.id = uer.user_id AND uer.is_deleted = true WHERE u.active = $1 OR uer.entity_category = $2
ORDER BY u.created_at DESC LIMIT $3 OFFSET $4'
values: [true, 'system', 10, 2]
*/
await select(
    [{ table: 'users', name: 'u' }, 
        {
            table: 'user_profiles',
            name: 'up',
            join_type: 'INNER',
            on: [{ left: 'u.id', right: 'up.user_id' }, { left: 'up.is_deleted', right: 'false' }],
        }, 
        {
            table: 'user_entity_relationship',
            name: 'uer',
            join_type: 'LEFT',
            on: [{ left: 'u.id', right: 'uer.user_id' }, { left: 'uer.is_deleted', right: 'true' }],
        }
    ],
    ['u.id', 'u.name', 'up.profile_picture', 'uer.entity'],
    { array: [
        ['u.active', true ], 
        ['uer.entity_category', '=', 'system']
    ], is_or: true },
    [{ field: 'u.created_at', is_asc: false }],
    10,
    2
)

insert(_table: string, _data: Object): Promise<QueryResult>
// example 'INSERT INTO users (name, age) VALUES ($1, $2) RETURNING *', values:['test',30]
await insert('users', { name: 'test', age: 30 })

update(_table: string, _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean }
): Promise<QueryResult>
// example 'UPDATE users SET name = $1, age = $2 WHERE id <= $3 AND active != $4 RETURNING *', values:['test', 30, 1, true]
await update('users', {name:'test', age: 30}
    { array: [
        ['id', '<=', 1 ],
        ['active', '!=', true ]
    ], is_or: false }
)

upsert(_table: string, _indexData: string[], _data: Object): Promise<QueryResult>
// example: 'INSERT INTO users (id, name, age) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age RETURNING *', values: [1, 'test', 30]
await upsert('users',['id'],
    {id: 1, name: 'test', age: 30},
)

delete(_table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean }
): Promise<QueryResult>
// example: 'DELETE FROM users WHERE id <= $1 AND active != $2 RETURNING *', values: [1, true]
await delete('users',
    { array: [ ['id', '<=', 1 ], ['active', '!=', true ] ], is_or: false },
)
```

## TODO
Unit test cases
Currently this only support postgresSQL connection using node-postgres, redis connection using ioredis, kafka queue using kafkajs.
Support of other databases / noSQL database, nodecache for caching, and RabbitMQ as message queue.

## Motivations
When we learn programming and read / write data to SQL database, we use libraries like node-postgres and interacts with master database directly.
It is normal for most cases. However, the loading on database will be huge when there are multiple instances / pods and a lot of concurrent users.

To cater the issue of overloading, read replica and caching are introduced on the read side. 
On the write side, strategies like database sharding / write-through cache / message queue / rate limiting are used.
But they involve complicated setup and change in application coding.

This module intends to minimize the changes required on the coding side when different cache / scaling methods are used.
Ideally, the developer will write queries like interacting with a database directly, no matter it is a single db, db with read replica, with cache layer, etc.
All caching logic is handled inside this module.
On the write side, it will return the actual result if master database is present. It also provides a method to send write queries via message queue and return an UUID if the message queue and message consumer support (for tracking write operations).

It is different from existing libraries like sequelize-redis-cache as this involves different caching logics and also the write part.


## Contributing
If you want to contribute to this project, please submit a pull request or create an issue for discussion. 

Working on README / documentations are also welcomed.

## Versioning
When a feature is built and merged into development, the version will be updated by prerelease snapshot.
When a release is going to happen, things will be merged into master. 
The version will be set mannually and a new tag will be created and package will be published.

## FAQ / Troubleshooting / Support
Please open an issue on github.

## Funding
You may buy me a coffee.

BTC: bc1qgl8g2xu3f60lkxgzg80jvykkmf3gywaky3c2tt

ETH / BNB / POL (pologon): 0xA5BC03ddc951966B0Df385653fA5b7CAdF1fc3DA
