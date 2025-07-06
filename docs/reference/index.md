Class Reference
===============

This section provides a comprehensive overview of the classes available in this library, including their attributes and methods. Each class is documented with its purpose and how it can be utilized in your projects.

Most interfaces are defined in the baseClass file, which is used by all classes. The `DBConnector` class is the main class that you will use to interact with the database.

In most cases, you will only need to interact with the `DBConnector` class, which serves as the main interface for database operations. The other classes are used internally to manage specific functionalities.

dbConnector function
--------------------
Main entry point for database connection.
This function creates a DBConnectorClass instance for external use.

masterConfig is required. If there is no other config, all queries will be done by master DB.

replicaConfig is optional and can be an array of DBConfig configs.
Read queries will be randomly distributed among replicas and there is no failover mechanism.

cacheConfig is optional and can be a CacheConfig config. Query results will be cached in supported cache layer.

msgQueueConfig is optional and can be a msgQueueConfig config. Write queries will be sent to the message queue and processed asynchronously.

@returns Object of DBConnector Class, which is an implementation of DBClass interface.

```typescript
dbConnector = (
  masterConfig: DBConfig,
  replicaConfig?: DBConfig[],
  cacheConfig?: CacheConfig,
  msgQueueConfig?: QueueConfig,
): DBClass
```