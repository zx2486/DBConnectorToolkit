Usage
=====

This page discusses how to use an object of dbConnector to run different kinds of queues.
You may check the reference for functions' details.

No matter what kind of database and settigns you are using, the basic usage is the same.
All queries are run asynchronously and return a Promise of QueryResult.
```typescript
{
    rows: any[], // array of rows returned from the query
    rowCount: number, // number of rows returned
    ttl: number || undefined, // time to live in seconds, only available when reading from cache
}
```
Write methods will return * at the end, which means the query is successful.

Raw queries
-----------
Running raw queries is done by the `query` async method.
```typescript
/**
 * @param _query: parameterized query 
 * {
    text: string,
    values: any[]
    }
    for example, { text: 'SELECT id, username FROM users WHERE age > $1 AND status = $2 ORDER BY modified DESC', values: [18,true] }
 * @param _isWrite, default is false, true to force master db to handle. Otherwise replica db and cache are used (if available).
 * @param _getLatest, default is false, true means the query result will come from db instead of cache. (replica if available)
 */
query(_query: Query, _isWrite?: boolean, _getLatest?: boolean): Promise<QueryResult>
```

Select queries
--------------
Select queries are run by the `select` async method.
We handle table joining by using an array of `TableWithJoin` objects. The tables are joined according to the order in the array.

Conditions are handled by an array of `QueryCondition` objects, which can be combined with AND or OR logic. Only single layer of conditions is supported. 
Each condition is an array of two elements: [field, value] or three elements: [field, operator, value]. If the operator is not provided, it defaults to '='.
Supported operators are '=', '!=', '<>, '<', '>', '<=', '>=', 'LIKE' and 'ILIKE'.
value in the conditions can be a string, number, boolean or object (except array).

Ordering is done by an array of `QueryOrder` objects, which specify the field and whether it is ascending or descending. The order of the array determines the order of the fields in the ORDER BY clause.

_getLatest is true when you want to get the latest data from the database instead of cache.

Examples:
```typescript
select(
    _table: TableWithJoin[],
    _fields: string[],
    _conditions?: { array: QueryCondition[], is_or: boolean },
    _order?: QueryOrder[],
    _limit?: number,
    _offset?: number,
    _getLatest?: boolean
  ): Promise<QueryResult>
// example 1: 'SELECT id, name FROM users'
await select([{ table: 'users' }],['id', 'name'])
/* example 2: 'SELECT u.id, u.name, up.profile_picture, uer.entity FROM users AS u 
INNER JOIN user_profiles AS up ON u.id = up.user_id AND up.is_deleted = false 
LEFT JOIN user_entity_relationship AS uer ON u.id = uer.user_id AND uer.is_deleted = true WHERE u.active = $1 OR uer.entity_category = $2
ORDER BY u.created_at DESC LIMIT $3 OFFSET $4'
values: [true, 'system', 10, 2]
*/
await select(
    [{ table: 'users', name: 'u' }, 
        {
            table: 'user_profiles',
            name: 'up',
            join_type: 'INNER',
            on: [{ left: 'u.id', right: 'up.user_id' }, { left: 'up.is_deleted', right: 'false' }],
        }, 
        {
            table: 'user_entity_relationship',
            name: 'uer',
            join_type: 'LEFT',
            on: [{ left: 'u.id', right: 'uer.user_id' }, { left: 'uer.is_deleted', right: 'true' }],
        }
    ],
    ['u.id', 'u.name', 'up.profile_picture', 'uer.entity'],
    { array: [
        ['u.active', true ], 
        ['uer.entity_category', '=', 'system']
    ], is_or: true },
    [{ field: 'u.created_at', is_asc: false }],
    10,
    2
)
```

Insert queries
--------------
Insert queries are run by the `insert` async method.

This method takes the table name and an object representing the data to be inserted. The object keys should match the table column names.
```typescript
insert(_table: string, _data: Object): Promise<QueryResult>
// example 'INSERT INTO users (name, age) VALUES ($1, $2) RETURNING *', values:['test',30]
await insert('users', { name: 'test', age: 30 })
```

Update queries
--------------
Update queries are run by the `update` async method.

The rows to be updated are specified by conditions, which are an array of `QueryCondition` objects. Only the columns specified in the data object will be updated.

```typescript
update(_table: string, _data: Object,
    _conditions?: { array: QueryCondition[], is_or: boolean }
): Promise<QueryResult>
// example 'UPDATE users SET name = $1, age = $2 WHERE id <= $3 AND active != $4 RETURNING *', values:['test', 30, 1, true]
await update('users', {name:'test', age: 30}
    { array: [
        ['id', '<=', 1 ],
        ['active', '!=', true ]
    ], is_or: false }
)
```

Upsert queries
--------------
Upsert queries are run by the `upsert` async method.
This method is similar to `insert`, but it will become update if the data already exists based on the specified index fields.
Be aware that the index fields should be unique in the table, otherwise it will throw an error.

```typescript
upsert(_table: string, _indexData: string[], _data: Object): Promise<QueryResult>
// example: 'INSERT INTO users (id, name, age) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, age = EXCLUDED.age RETURNING *', values: [1, 'test', 30]
await upsert('users',['id'],
    {id: 1, name: 'test', age: 30},
)
```

Delete queries
--------------
Delete queries are run by the `delete` async method.
Delete rows are specified by conditions, which are an array of `QueryCondition` objects.
```typescript
delete(_table: string,
    _conditions?: { array: QueryCondition[], is_or: boolean }
): Promise<QueryResult>
// example: 'DELETE FROM users WHERE id <= $1 AND active != $2 RETURNING *', values: [1, true]
await delete('users',
    { array: [ ['id', '<=', 1 ], ['active', '!=', true ] ], is_or: false },
)
```
