Class Reference
===============

This section provides a comprehensive overview of the classes available in this library, including their attributes and methods. Each class is documented with its purpose and how it can be utilized in your projects.

Most interfaces are defined in the baseClass file, which is used by all classes. The `DBConnector` class is the main class that you will use to interact with the database.

In most cases, you will only need to interact with the `DBConnector` class, which serves as the main interface for database operations. The other classes are used internally to manage specific functionalities.

dbConnector function
--------------------
Main entry point for database connection.
This function creates a DBConnectorClass instance for external use.
masterConfig
replicaConfig is optional and can be an array of PostgreSQL configs.
Read queries will be randomly distributed among replicas and there is no failover mechanism.
redisConfig is optional and can be a Redis config. Queries result will be cached in Redis
@param masterConfig required, if no other config, all queries will be done by master DB.
@param replicaConfig optional, Read (SELECT) queries will be randomly distributed among replicas.
If selected replica goes wrong, will failback to master to handle the query.
@param cacheConfig optional and can be a Redis config. Queries result will be cached in Redis
@returns Object of DBConnector Class, which is an implementation of DBClass interface.

```typescript
dbConnector = (
  masterConfig: DBConfig,
  replicaConfig?: DBConfig[],
  cacheConfig?: CacheConfig,
  msgQueueConfig?: QueueConfig,
): DBClass
```