"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dbClass_1 = require("./dbClass");
const redisClass_1 = require("./redisClass");
const dbConnectorClass_1 = __importDefault(require("./dbConnectorClass"));
/* type MsgQueueConfig = {
  host?: string;
  port?: number;
};
*/
const dbConnector = (masterConfig, replicaConfig, redisConfig) => {
    if (!masterConfig || masterConfig.client !== 'pg') {
        throw new Error('Master DB config is required and must be a PostgreSQL config');
    }
    const masterDB = new dbClass_1.PgClass(masterConfig);
    const replicaDB = (replicaConfig) ? new dbClass_1.PgClass(replicaConfig) : undefined;
    const redis = (redisConfig) ? new redisClass_1.RedisClass(redisConfig) : undefined;
    return new dbConnectorClass_1.default(masterDB, replicaDB, redis);
};
exports.default = dbConnector;
