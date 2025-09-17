SQLite3Class
=======

SQLite3Class extends `SQLClass` and implements the `DBClass` interface specifically for sqlite3 databases, using the sqlite3 library. 

There is no Pool connection for SQLite3, so all queries are executed using the same client, single connection.

Also there is no support for transactions, as SQLite3 does not support concurrent writes. The transaction methods are implemented to execute the queries one by one using the client.
```typescript
transaction(_callbacks: (
    (_previousResult: QueryResult, _client: any) => Promise<QueryResult>
  )[]): Promise<QueryResult>
```