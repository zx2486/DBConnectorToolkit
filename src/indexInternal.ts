import type {
  DBConfig, CacheConfig, CacheClass,
} from './baseClass'
import PgClass from './pgClass'
import MariaClass from './mariaClass'
import SQLite3Class from './sqlite3Class'

import RedisClass from './redisClass'
import IORedisClass from './ioredisClass'
import NodeCacheClass from './nodeCacheClass'
import MemcachedClass from './memcachedClass'

const getCacheObj = (_cacheConfig?: CacheConfig): CacheClass | undefined => {
  const supportClasss = new Map<string,
    typeof RedisClass | typeof IORedisClass | typeof NodeCacheClass | typeof MemcachedClass>([
      ['redis', RedisClass],
      ['ioredis', IORedisClass],
      ['nodecache', NodeCacheClass],
      ['memcached', MemcachedClass],
    ])
  if (!_cacheConfig || !_cacheConfig.client
    || !supportClasss.has(_cacheConfig.client)) {
    return undefined
  }
  const CacheClassConstructor = supportClasss.get(_cacheConfig.client)
  return (CacheClassConstructor) ? new CacheClassConstructor(_cacheConfig) : undefined
}

const getDBObj = (_dbConfig?: DBConfig): PgClass | undefined => {
  const supportClasss = new Map<string, typeof PgClass>([
    ['pg', PgClass],
    ['mariadb', MariaClass],
    ['sqlite3', SQLite3Class],
  ])
  if (!_dbConfig || !_dbConfig.client
    || !supportClasss.has(_dbConfig.client)) {
    return undefined
  }
  const DBClassConstructor = supportClasss.get(_dbConfig.client)
  return (DBClassConstructor) ? new DBClassConstructor(_dbConfig) : undefined
}

export { getCacheObj, getDBObj }
