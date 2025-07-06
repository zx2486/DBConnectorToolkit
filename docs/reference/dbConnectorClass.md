dbConnectorClass
================

An implementation of the DBClass interface, the `dbConnectorClass` is designed for external use to manage database operations. It provides methods for connecting to the database, executing queries, and handling transactions. The class supports both master and replica databases, allowing for efficient read and write operations.

In this implementation, most methods will go back to the query function (write calls will have _isWrite = true).
When message queue is not present, write calls will always go to master database.
When message queue is present, write calls will send the query to message queue and return an UUID.

```typescript
/* Run a query to the database, reading from cache if available
 * @param _query
 * @param _isWrite, if true, always query to master db and ignore _getLatest.
 * @param _getLatest, if true, always query to db (replica, master if replica is undefined)
 * and will not create/update/read cache.
 * If both _isWrite and _getLatest are false, it will read from cache if available, db if not.
 * It will also revalidate cache in background if needed
 * @returns result of the query
 */
query(_query: Query, _isWrite: boolean = false, _getLatest: boolean = false): Promise<QueryResult>
```