ioredisClass
============

This provides a class `IORedisClass`, implementing `CacheClass` interface, which is used to connect to a Redis database using the ioredis library.

getPoolClient of this class will always return the same client, which is the behavior of ioredis. 
clearAllCache will clear all data in the master nodes of the redis cluster. So there maybe a case where some slave nodes are not cleared until master slave sync is done.
