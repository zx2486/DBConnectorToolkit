dbClass
=======

This provides a class PgClass, implementing DBClass interface, which is used to connect to a PostgreSQL database using the pg library (mainly Pool).

It has an unique method validateQuery, which uses EXPLAIN to validate the query and return the execution plan.
It is used to ensure that the query is valid and can be executed without errors.
```typescript
validateQuery(query: Query): Promise<void>
```