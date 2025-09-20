nodeCacheClass
============

This provides a class `NodeCacheClass`, implementing `CacheClass` interface, which is used to maintain to a node cache using the node-cache library.

As there is nothing to connect, there is no need to set url in the config.

getPoolClient of this class will always return the same client, which is the default behavior.
Operations are done in useClones: true, so that it works more like using a real cache server.