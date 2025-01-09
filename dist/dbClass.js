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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PgClass = void 0;
const bunyan_1 = __importDefault(require("bunyan"));
const uuid_1 = __importDefault(require("uuid"));
const pg_1 = require("pg");
class PgClass {
    constructor(dbConfig) {
        var _a, _b, _c, _d;
        this.clients = {};
        this.dbConfig = dbConfig;
        this.logger = bunyan_1.default.createLogger({
            name: 'PgClass',
            streams: [{ stream: process.stderr, level: dbConfig.logLevel }],
        });
        const connectionString = `postgres://${dbConfig.username}:${dbConfig.password}@${dbConfig.endpoint}:${dbConfig.port}/${dbConfig.database}`;
        this.clients = [];
        const options = {
            connectionString,
            idleTimeoutMillis: (_a = this.dbConfig.idleTimeoutMillis) !== null && _a !== void 0 ? _a : 10,
            min: (_b = this.dbConfig.minConnection) !== null && _b !== void 0 ? _b : 1,
            max: (_c = this.dbConfig.maxConnection) !== null && _c !== void 0 ? _c : 10,
            allowExitOnIdle: (_d = this.dbConfig.allowExitOnIdle) !== null && _d !== void 0 ? _d : true,
        };
        this.pool = new pg_1.Pool(options)
            .on('error', (err) => { this.logger.error({ event: 'PGPool - constructor - error', err }); })
            .on('connect', () => { this.logger.info({ event: 'PGPool - constructor - connect' }); })
            .on('acquire', () => { this.logger.info({ event: 'PGPool - constructor - acquire' }); })
            .on('remove', () => { this.logger.info({ event: 'PGPool - constructor - remove' }); });
        this.logger.info({ event: `Pool (${this.dbConfig.endpoint}:${this.dbConfig.port}) is ready` });
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const clientId = uuid_1.default.v4();
                // only used by transaction
                this.clients[clientId] = yield this.pool.connect();
            }
            catch (err) {
                this.logger.error({ event: 'PGPool - connect', err });
                throw new Error('Failed to connect to database');
            }
        });
    }
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield Promise.all(Object.keys(this.clients).map((id) => __awaiter(this, void 0, void 0, function* () {
                    if (Object.prototype.hasOwnProperty.call(this.clients, id)) {
                        yield this.clients[id].removeAllListeners();
                        yield this.clients[id].release();
                        delete this.clients[id];
                    }
                })));
                yield this.pool.end();
            }
            catch (err) {
                this.logger.error({ event: 'PGPool - disconnect', err });
                throw new Error('Failed to disconnect from database');
            }
        });
    }
    isconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.pool.query('SELECT 1');
                return true;
            }
            catch (err) {
                this.logger.error({ event: 'PGPool - isconnect', err });
                return false;
            }
        });
    }
    query(_query_1) {
        return __awaiter(this, arguments, void 0, function* (_query, _isWrite = false, _getLatest = false) {
            if (!(yield this.isconnect())) {
                yield this.pool.connect();
            }
            const result = yield this.pool.query(_query.text, _query.values);
            return { rows: result, count: result.length || 0 };
        });
    }
    validateQuery(query) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.pool.query(`EXPLAIN ${query.text}`, query.values);
            }
            catch (err) {
                this.logger.error({ event: 'validateQuery', err });
                throw new Error('Invalid SQL query');
            }
        });
    }
    buildSelectQuery(_table, _fields, _conditions, _order, _limit, _offset) {
        if (!_table || _table.length < 1 || !_fields || _fields.length < 1) {
            this.logger.error({ event: 'buildSelectQuery', error: 'Invalid query' });
            throw new Error('Invalid query');
        }
        // Validate table names and fields
        _table.forEach((t) => {
            PgClass.validateIdentifier(t.table);
            if (t.name)
                PgClass.validateIdentifier(t.name);
            if (t.on) {
                t.on.forEach(({ left, right }) => {
                    PgClass.validateIdentifier(left);
                    PgClass.validateIdentifier(right);
                });
            }
        });
        _fields.forEach(PgClass.validateIdentifier);
        const fieldQuery = `SELECT ${_fields.join(', ')} FROM `;
        // Write the table and join part of the query
        let tableQuery = `${_table[0].table} ${_table[0].name ? `AS ${_table[0].name}` : ''}`;
        if (_table.length > 1) {
            tableQuery += _table.slice(1).map((t) => `${t.join_type ? `${t.join_type} JOIN` : ''} ${t.table} ${t.name ? `AS ${t.name}` : ''} 
      ON ${t.on ? t.on.map(({ left, right }) => `${left} = ${right}`).join(' AND ') : 'TRUE'}`)
                .join(', ');
        }
        const values = [];
        let condition = '';
        if (_conditions && _conditions.array && _conditions.array.length > 0) {
            _conditions.array.forEach((c) => {
                PgClass.validateIdentifier(c.field);
            });
            condition = ` WHERE ${_conditions.array.map((c) => {
                values.push(c.value);
                return `${c.field} ${c.comparator || '='} $${values.length}`;
            }).join(` ${_conditions.is_or ? ' OR ' : ' AND '}`)}`;
        }
        let order = '';
        if (_order && _order.length > 0) {
            _order.forEach((o) => PgClass.validateIdentifier(o.field));
            order = ` ORDER BY ${_order.map((o) => `${o.field} ${o.is_asc ? 'ASC' : 'DESC'}`).join(', ')} `;
        }
        const limit = (_limit) ? ` LIMIT $${values.push(_limit)} ` : '';
        const offset = (_offset) ? ` OFFSET $${values.push(_offset)} ` : '';
        const query = { text: `${fieldQuery}${tableQuery}${condition}${order}${limit}${offset} `, values };
        // Do not validate query for now to save time
        // await this.validateQuery(query)
        return query;
    }
    select(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.query(_query);
        });
    }
    insert(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.query(_query, true);
        });
    }
    update(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.query(_query, true);
        });
    }
    upsert(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.query(_query, true);
        });
    }
    delete(_query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.query(_query, true);
        });
    }
}
exports.PgClass = PgClass;
// Validate inputs to not allow SQL injection
PgClass.validateIdentifier = (identifier) => {
    if (!/^[a-zA-Z_.][a-zA-Z0-9_.]*$/.test(identifier)) {
        throw new Error(`Invalid identifier: ${identifier}`);
    }
};
