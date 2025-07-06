Getting Started
===============

This section discusses how to install and use this library in a minimal setup.

Installation
------------
```bash
# Include installation commands here
npm install dbconnectortoolkit
```

How to Use
----------
1) Connecting with the master database, select * from users and then insert a row into post
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
    await insert('posts', { user_id: 'abcd', content: 'Post content' })
} catch (err) {
    // throw when database cannot login or something wrong with the query
    console.error('Error:', err)
} finally {
    await dbConnector.disconnect()
}
```

2) Distribute read queries to read replica databases while write ones still go to master
```typescript
const replicaDBConfig = [
    // an array of replica setup, same format of masterDBConfig
    {
    ...
    },...
]
db = dbConnector(masterDBConfig, replicaDBConfig);
// Other operations are same as before
```

3) Introduce cache layer and automatically cache all read requests
```typescript
const cacheConfig = {
    client: 'ioredis',
    url: 'localhost@6379',
    dbIndex: 1, // database index, default is 0
    cacheHeader: 'dbCache', // cache will be stored using key: dbCache:${sha256 hash of the raw query}
    cacheTTL: 30, // Cache expiry in 30 sec
    revalidate: 5, // When cache expires in 5 sec and there is a read, revalidate the cache
}
db = dbConnector(masterDBConfig, replicaDBConfig, cacheConfig);
// Other operations are same as before
```

Sending write queries to message queue
--------------------------------------
Sometimes backend is arranged in multiple layers and public facing pods should not have database write access directly. Before this work, there will be a need to change code to redirect every write request to processing nodes.
Using thie library, the change is only a few.

For public facing nodes, just add the message queue config to dbConnector. Then all write requests will be sent to the message queue.
```typescript
const kafkaConfig = {
  client: 'kafka',
  appName: 'web-two-layer',
  brokerList: ['localhost:9092'],
  dbTopic: 'writing_db_topic', // topic to send the write queue
}
// There is no master here
// all reads will be handled by replica and cache
// all writes will be sent to message queue
db = dbConnector(replicaDBConfig[0], replicaDBConfig, redisConfig, kafkaConfig);
```

For the processing nodes, they will need to start a consumer to receive the messages and process.
```typescript
const KafkaClass = require('dbconnectortoolkit/dist/kafkaClass').default;
const masterDBConfig = {
  ...
}
db = dbConnector(masterDBConfig);
const kafkaConfig = {
  client: 'kafka',
  appName: 'web-two-layer',
  brokerList: ['localhost:9092'],
  groupId: 'web-two-layer-consumer-group',
}
msgQueue = new KafkaClass(kafkaConfig);
await msgQueue.connect(false);
await msgQueue.connect(true); // For the dead letter queue
msgQueue.subscribe([{ // notice this is an array of topic-callback objects
    topic: 'writing_db_topic',
    callback: async (message) => {
        try {
            /*  message:{
                    topic: dbTopic,
                    message: JSON.stringify(_query),
                    key: uuid
                }
            */
            // Processing logic to a write requests
            ...
        } catch (error) {
            // In case something is wrong, send the message to dead letter queue
            msgQueue.send([
            {
                topic: `writing_db_topic-dlq`,
                message: JSON.stringify(message),
                key: crypto.randomUUID(),
            }
            ]).then((msgRes) => {
                console.info(`Sent problematic message to dead letter with result:${msgRes}`);
            }).catch(err => {
                console.error('Error sending problematic message to dead letter:', err);
            });
        }
    }
}])
```
