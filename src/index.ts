import type { DBConfig, CacheConfig, DBClass } from './baseClass'
import PgClass from './dbClass'

import RedisClass from './redisClass'

import DBConnectorClass from './dbConnectorClass'

const dbConnector = (
  masterConfig: DBConfig,
  replicaConfig?: DBConfig,
  redisConfig?: CacheConfig,
  // msgQueueConfig?: MsgQueueConfig,
): DBClass => {
  if (!masterConfig || masterConfig.client !== 'pg') {
    throw new Error('Master DB config is required and must be a PostgreSQL config')
  }
  const masterDB = new PgClass(masterConfig)
  const replicaDB = (replicaConfig && replicaConfig.client === 'pg')
    ? new PgClass(replicaConfig) : undefined
  const redis = (redisConfig && redisConfig.client === 'redis')
    ? new RedisClass(redisConfig) : undefined

  return new DBConnectorClass(masterDB, replicaDB, redis)
}
export default dbConnector
