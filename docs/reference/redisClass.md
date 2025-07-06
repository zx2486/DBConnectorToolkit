redisClass
==========

This provides a class `RedisClass`, implementing `CacheClass` interface, which is used to connect to a Redis database using the redis library.

Although redis cluster is supported, but there maybe unexpected behavior when redis nodes changes or cluster topology changes.