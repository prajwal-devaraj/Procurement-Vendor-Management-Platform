// db/connection.js
//
// I originally tried better-sqlite3 here but it requires native compilation
// and that breaks in CI and on some dev machines without python/node-gyp set up.
// Switched to sql.js (WASM SQLite) which is pure JS — slower on large datasets
// but for a procurement system with thousands of records it's completely fine.
//
// The tradeoff is that sql.js keeps the entire DB in memory and I have to
// explicitly flush it to disk after writes. persist() handles that.

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_DB_FILE = path.join(__dirname, 'procurement.sqlite');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

let SQL = null;
let sqliteDb = null;
let currentDbFile = null;

function persist() {
    const data = sqliteDb.export();
    fs.writeFileSync(currentDbFile, Buffer.from(data));
}

async function init(dbFile) {
    const resolvedFile = dbFile
        ? path.resolve(dbFile)
        : (process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : DEFAULT_DB_FILE);

    if (sqliteDb && currentDbFile === resolvedFile) return wrapper;

    currentDbFile = resolvedFile;
    sqliteDb = null;

    if (!SQL) {
        SQL = await initSqlJs({
            locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
        });
    }

    if (fs.existsSync(currentDbFile)) {
        const buf = fs.readFileSync(currentDbFile);
        sqliteDb = new SQL.Database(buf);
    } else {
        sqliteDb = new SQL.Database();
        const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
        sqliteDb.run(schema);
        persist();
    }

    return wrapper;
}

function bindParams(stmt, params) {
    if (Array.isArray(params)) {
        stmt.bind(params);
    } else if (params && typeof params === 'object') {
        const named = {};
        for (const [k, v] of Object.entries(params)) named[`@${k}`] = v;
        stmt.bind(named);
    }
}

// Exposing a better-sqlite3-compatible interface so I could swap drivers
// later if needed without touching route code.
const wrapper = {
    run(sql, params = []) {
        const stmt = sqliteDb.prepare(sql);
        bindParams(stmt, params);
        stmt.step();
        stmt.free();
        persist();
        return { changes: sqliteDb.getRowsModified() };
    },

    get(sql, params = []) {
        const stmt = sqliteDb.prepare(sql);
        bindParams(stmt, params);
        let row = null;
        if (stmt.step()) row = stmt.getAsObject();
        stmt.free();
        return row;
    },

    all(sql, params = []) {
        const stmt = sqliteDb.prepare(sql);
        bindParams(stmt, params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    },

    exec(sql) {
        sqliteDb.run(sql);
        persist();
    },

    transaction(fn) {
        return (...args) => {
            sqliteDb.run('BEGIN');
            try {
                const result = fn(...args);
                sqliteDb.run('COMMIT');
                persist();
                return result;
            } catch (err) {
                sqliteDb.run('ROLLBACK');
                throw err;
            }
        };
    },

    close() {
        if (sqliteDb) { sqliteDb.close(); sqliteDb = null; }
        currentDbFile = null;
    }
};

module.exports = { init };
