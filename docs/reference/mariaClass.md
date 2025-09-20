mariaClass
=======

MariaClass extends `SQLClass` and implements the `DBClass` interface specifically for mariaDB databases, using the mariadb library (mainly Pool). This should also work with MySQL databases.

As mariaDB does not support insert on duplicate update, the upsert method is handled using a transacion, consisting an update statement, and then an insert when no record exists, at last a select statement to get the result. Therefore buildUpsertQuery method is not implemented, buildUpsertQueries is used instead. Also the update method will not return anything, as mariadb does not support returning clause.
```typescript
buildUpsertQueries(_table: string, _indexData: string[], _data: Object): Query[]
```