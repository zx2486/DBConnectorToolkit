import type { DBConfig, CacheConfig } from './baseClass.ts'
import { PgClass, DBClass } from './dbClass'

import { RedisClass } from './redisClass'

import DBConnectorClass from './dbConnectorClass'

/* type MsgQueueConfig = {
  host?: string;
  port?: number;
};
*/

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
  const replicaDB = (replicaConfig) ? new PgClass(replicaConfig) : undefined
  const redis = (redisConfig) ? new RedisClass(redisConfig) : undefined

  return new DBConnectorClass(masterDB, replicaDB, redis)
}
export default dbConnector
