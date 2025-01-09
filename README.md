# DBConnectorToolkit
This module provides an integrated tool to connect database under different settings, single db, master with read replica, with redis for caching, and use message queue to collect writes for central processing.

## Installation
```bash
# Include installation commands here

```

## Sample use case
The easiest one, just input connection string and call connect()


## Description
When we learn programming and read / write data to SQL database, we use libraries like node-postgres and interacts with master database directly.
It is normal for most cases. However, the loading on database will be huge when there are multiple instances / pods and a lot of concurrent users.

To cater the issue of overloading, read replica and caching are introduced on the read side. 
On the write side, strategies like database sharding / write-through cache / message queue / rate limiting are used.
But they involve complicated setup and change in application coding.

This module intends to minimize the changes required on the coding side when different cache / scaling methods are used.
Ideally, the developer will write like interacting with a database directly, with write operations only have an UUID (tracking write operations) to return.
All caching logic is handled inside this module.

It is different from existing libraries like sequelize-redis-cache as this involves different caching logics and also the write part.




## Usage
This module will support the following caching arrangements

### Master database only
Select queries will be cached in memory if results are small. Writes will send to DB directly. No auto invalidations.

### Master database with read replica / read-only slave
Select queries will be directed to read-only slaves if there is no in memory cache, and build up memory cache if results are small. Write queries will send to master directly. 
Error will / will not return when read replica is not reachable.
Default is throwing error to prevent master database from overloading by excessive reads.

### + caching service like redis (Base)
Same Strategy.
Query results (under a certain size) will be cached in caching service with SHA-1 of the query input as cache key.
Cache of a query will be revalidated async if it has past 90% of TTL and the query still comes.

### Base + list of read-heavy queries
Cache on read-heavy queries will be built on initialization and revalidated regularly.

### Base + table for query logging
Query history will be stored in the database (async, non-guranteed and append only), with whether it is handled by memory / redis / database. 
Top 5 queries handled by database will be revalidated regularly.

### read replica / read-only slave + caching (Read mode)
For API service nodes which do not have calls to write to database and no need to build cache. Same strategy as Base, but writes will throw error.

### Read mode + message queue like Kafka + table for query status queries
For API service nodes which do not write data to master directly.
All writes will go to the message queue instead of master database. 
Each write will be assigned with an UUID as tracker ID.
There is a need to implement kafka consumer (should not be inside the frontend / API services) to consume the messages, update database and revalidate the cache.

### Message consumer (master database + message queue)
A special usage which will process the messages and update database.
It will first pick the message ID and insert into a database table, and when business logic is finished, write the result into database.
Update cache if there are caching service and caching queries.


## Contributing
If you want to contribute to this project, please submit a pull request or create an issue for discussion. 
Opening distribution on README / documentation writing is also welcomed.


## FAQ / Troubleshooting / Support
Please open an issue on github.

## Future work
Currently this only support postgresSQL connection using node-postgres, redis connection using redis, and kafka connection using node-rdkafka.
When time is allowed other database / caching system / messenge queue will be supported.
