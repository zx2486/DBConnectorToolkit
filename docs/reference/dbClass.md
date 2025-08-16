dbClass and pgClass
=======

dbClass provides a class SQLClass, implementing DBClass interface, which provides a base class for all SQL type database clients.
pgClass extends SQLClass and implements the DBClass interface specifically for PostgreSQL databases, using the pg library (mainly Pool).

It has an unique method validateQuery, which uses EXPLAIN to validate the query and return the execution plan.
It is used to ensure that the query is valid and can be executed without errors.
```typescript
validateQuery(query: Query): Promise<void>
```