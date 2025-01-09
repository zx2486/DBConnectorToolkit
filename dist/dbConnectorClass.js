"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// export default class DBConnectorClass implements DBClass {
class DBConnectorClass {
    constructor(_masterDB, _replicaDB, _redis, _msgQueue) {
        this.masterDB = _masterDB;
        this.replicaDB = _replicaDB || undefined;
        this.redis = _redis || undefined;
        this.msgQueue = _msgQueue || undefined;
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([this.masterDB, this.replicaDB, this.redis, this.msgQueue]
                .filter((db) => db)
                .map((db) => db.connect()));
        });
    }
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([this.masterDB, this.replicaDB, this.redis, this.msgQueue]
                .filter((db) => db)
                .map((db) => db.disconnect()));
        });
    }
    isconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.all([this.masterDB, this.replicaDB, this.redis, this.msgQueue]
                .filter((db) => db)
                .map((db) => db.isconnect())).then((results) => results.every((result) => result));
        });
    }
    buildSelectQuery(_table, _fields, _conditions, _order, _limit, _offset) {
        return this.masterDB.buildSelectQuery(_table, _fields, _conditions, _order, _limit, _offset);
    }
    query(_query_1) {
        return __awaiter(this, arguments, void 0, function* (_query, _isWrite = false, _isCache = true) {
            var _a, _b;
            if (_isWrite) {
                return this.masterDB.query(_query, _isWrite);
            }
            const db = (this.replicaDB) ? this.replicaDB : this.masterDB;
            const cacheResult = (this.redis && this.redis.isconnect() && _isCache)
                ? yield this.redis.query(_query) : { result: { rows: [], count: 0 }, ttl: 0 };
            if (!_isCache || !(cacheResult === null || cacheResult === void 0 ? void 0 : cacheResult.result)) {
                // if there is no cache, query to db
                const result = yield db.query(_query);
                if (_isCache && result) {
                    if (this.redis && this.redis.isconnect()) {
                        // save result into cache in background
                        this.redis.buildCache(_query, result);
                    }
                }
                return result;
            }
            if (this.redis && cacheResult.ttl <= (((_b = (_a = this.redis) === null || _a === void 0 ? void 0 : _a.getConfig()) === null || _b === void 0 ? void 0 : _b.revalidate) || 0)) {
                // revalidate cache in the background
                this.redis.buildCache(_query, yield db.query(_query));
            }
            return cacheResult.result;
        });
    }
}
exports.default = DBConnectorClass;
