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
exports.RedisClass = void 0;
class RedisClass {
    constructor(_config) {
        this.cacheConfig = _config;
    }
    getConfig() {
        return this.cacheConfig;
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            this.cache = { config: this.cacheConfig };
            return this.cache;
        });
    }
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.cache.disconnect();
        });
    }
    isconnect() {
        return this.cache.isconnect();
    }
    query(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.cache.isconnect())
                yield this.cache.connect();
            const hashKey = RedisClass.hashkeyOf(_query);
            const result = this.cache.query(hashKey);
            const ttl = this.cache.ttl(hashKey);
            return { result, ttl };
        });
    }
    static hashkeyOf(_query) {
        return _query.text + _query.values;
    }
    buildCache(_query, _result) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const key = RedisClass.hashkeyOf(_query);
            yield this.cache.set(key, _result, ((_a = this.cacheConfig) === null || _a === void 0 ? void 0 : _a.cacheTTL) || 3600);
        });
    }
    clearCache(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.cache.isconnect())
                yield this.cache.connect();
            yield this.cache.clear(RedisClass.hashkeyOf(_query));
        });
    }
    clearAllCache() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.cache.isconnect())
                yield this.cache.connect();
            yield this.cache.flushall();
        });
    }
}
exports.RedisClass = RedisClass;
