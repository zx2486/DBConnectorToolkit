import type { DBConfig, CacheConfig, DBClass } from './baseClass'
import PgClass from './dbClass'

import RedisClass from './redisClass'

import DBConnectorClass from './dbConnectorClass'

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
  // msgQueueConfig?: MsgQueueConfig,
): DBClass => {
  if (!masterConfig || masterConfig.client !== 'pg') {
    throw new Error('Master DB config is required and must be a PostgreSQL config')
  }
  const masterDB = new PgClass(masterConfig)
  const replicaDB = (replicaConfig && replicaConfig.length > 0)
    ? replicaConfig.filter(({ client }) => client === 'pg').map((config) => new PgClass(config)) : []
  const redis = (cacheConfig && cacheConfig.client === 'redis')
    ? new RedisClass(cacheConfig) : undefined

  return new DBConnectorClass(masterDB, replicaDB, redis)
}
export default dbConnector
