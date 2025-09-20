memcachedClass
============

This provides a class `MemcachedClass`, implementing `CacheClass` interface, which is used to connect a mecached service using memcached library.

As authentication is not supported in memcached, there is no need to set username and password in the config. pingInterval in the config will be used as the time between reconnection attempts. keepAlive in memcached will be used as the the idle timeout. 

Most of the config options are not supported in memcached. Besides the abovementioned, only url, additionalNodeList, cacheTTL, connectTimeout and cacheHeader are used.

getPoolClient of this class will always return the same client, which is the default behavior.

As memcached cannot return the ttl of a key, the ttl value is always -1 and revalidate checking will not work. The config is set to be -100 to avoid any confusion.