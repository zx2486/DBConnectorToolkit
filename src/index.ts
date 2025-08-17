import type {
  DBConfig, CacheConfig, DBClass, CacheClass, QueueConfig,
} from './baseClass'
import PgClass from './pgClass'
import MariaClass from './mariaClass'

import RedisClass from './redisClass'
import IORedisClass from './ioredisClass'
import DBConnectorClass from './dbConnectorClass'
import KafkaClass from './kafkaClass'

const getCacheObj = (_cacheConfig?: CacheConfig): CacheClass | undefined => {
  const supportClasss = new Map<string, typeof RedisClass | typeof IORedisClass>([
    ['redis', RedisClass],
    ['ioredis', IORedisClass],
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
  ])
  if (!_dbConfig || !_dbConfig.client
    || !supportClasss.has(_dbConfig.client)) {
    return undefined
  }
  const DBClassConstructor = supportClasss.get(_dbConfig.client)
  return (DBClassConstructor) ? new DBClassConstructor(_dbConfig) : undefined
}

/**
 * Main entry point for database connection.
 * This function creates a DBConnectorClass instance for external use.
 * masterConfig
 * replicaConfig is optional and can be an array of PostgreSQL configs.
 * Read queries will be randomly distributed among replicas and there is no failover mechanism.
 * redisConfig is optional and can be a Redis config. Queries result will be cached in Redis
 * @param masterConfig required, if no other config, all queries will be done by master DB.
 * @param replicaConfig optional, Read (SELECT) queries will be randomly distributed among replicas.
 * If selected replica goes wrong, will failback to master to handle the query.
 * @param cacheConfig optional and can be a Redis config. Queries result will be cached in Redis
 * @returns
 */
const dbConnector = (
  masterConfig: DBConfig,
  replicaConfig?: DBConfig[],
  cacheConfig?: CacheConfig,
  msgQueueConfig?: QueueConfig,
): DBClass => {
  if (!masterConfig) {
    throw new Error('Master DB config is required')
  }
  const masterDB = getDBObj(masterConfig)
  if (!masterDB) {
    throw new Error('Invalid Master DB config')
  }
  const replicaDB = (replicaConfig && replicaConfig.length > 0)
    ? replicaConfig.map((config) => getDBObj(config))
      .filter((db) => db !== undefined) : []
  const redis = getCacheObj(cacheConfig)
  const msgQueue = (msgQueueConfig && msgQueueConfig.client === 'kafka') ? new KafkaClass(msgQueueConfig) : undefined
  return new DBConnectorClass(masterDB, replicaDB, redis, msgQueue)
}

export default dbConnector
