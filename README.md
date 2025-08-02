# DBConnectorToolkit
This module provides an integrated tool to connect database under different settings, single db, master with read replica, with redis for caching, and allow using message queue to centralize db writes requests.
The main purpose is to reduce code changes on application with growing traffic and upgrading in infra.

Documentation is available at [https://dbconnectortoolkit.readthedocs.io](https://dbconnectortoolkit.readthedocs.io).

We have created a demo project ([DBConnectorSampleWeb](https://github.com/zx2486/DBConnectorSampleWeb)) and a demo site ([dbconnectorapi.authpaper.com](https://dbconnectorapi.authpaper.com)) to illustrate how this library works.

## Installation
```bash
# Include installation commands here
npm install dbconnectortoolkit
```

## Sample use case
Suppose you have a postgres database (web) and would like to select data from it.
```typescript
const dbConnector = require('dbconnectortoolkit').default;

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

## TODO
Unit test cases
Currently this only support postgresSQL connection using node-postgres, redis connection using ioredis, kafka queue using kafkajs.
Support of other databases / noSQL database, nodecache for caching, and RabbitMQ as message queue.
Support of db transaction when message queue is used to centralize db writes.

## Contributing
If you want to contribute to this project, please submit a pull request or create an issue for discussion. 

Working on README / documentations are also welcomed.

## FAQ / Troubleshooting / Support
Please open an issue on github.

## Funding
You may buy me a coffee.

BTC: bc1qgl8g2xu3f60lkxgzg80jvykkmf3gywaky3c2tt

ETH / BNB / POL (pologon): 0xA5BC03ddc951966B0Df385653fA5b7CAdF1fc3DA
