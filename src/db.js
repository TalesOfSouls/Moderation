/**
 * SQLite access (node:sqlite, built into Node.js >= 22.5)
 *
 * The moderation tool uses the same database file as the website (TalesOfSouls.db).
 */
'use strict';

const path = require('node:path');
const fs   = require('node:fs');

// node:sqlite prints an "experimental" warning on some Node versions, it is not useful for this application
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
    if (String(warning).includes('SQLite')) {
        return;
    }

    return emitWarning.call(process, warning, ...args);
};

const { DatabaseSync } = require('node:sqlite');

const DEFAULT_PATH = path.resolve(__dirname, '..', '..', 'Website', 'TalesOfSouls.db');

let instance = null;

/**
 * Database wrapper with a few shortcuts
 */
class Database
{
    constructor (file)
    {
        if (!fs.existsSync(file)) {
            throw new Error('Database not found: ' + file + ' (set TOS_DB to the path of TalesOfSouls.db)');
        }

        this.file       = file;
        this.connection = new DatabaseSync(file);
        this.statements = new Map();

        // the website (PHP) writes into the same file, wait instead of failing when it is locked
        this.connection.exec('PRAGMA busy_timeout = 5000');
        this.connection.exec('PRAGMA foreign_keys = OFF');
    }

    prepare (sql)
    {
        let statement = this.statements.get(sql);
        if (statement === undefined) {
            statement = this.connection.prepare(sql);
            this.statements.set(sql, statement);
        }

        return statement;
    }

    all (sql, ...params)
    {
        return this.prepare(sql).all(...params);
    }

    get (sql, ...params)
    {
        return this.prepare(sql).get(...params) ?? null;
    }

    value (sql, ...params)
    {
        const row = this.get(sql, ...params);

        return row === null ? null : Object.values(row)[0];
    }

    run (sql, ...params)
    {
        return this.prepare(sql).run(...params);
    }

    exec (sql)
    {
        this.connection.exec(sql);
    }

    /**
     * Run a function in a transaction
     *
     * @template T
     * @param {() => T} fn
     * @return {T}
     */
    transaction (fn)
    {
        this.connection.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.connection.exec('COMMIT');

            return result;
        } catch (error) {
            this.connection.exec('ROLLBACK');
            throw error;
        }
    }

    tableExists (table)
    {
        return this.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table) !== null;
    }

    columns (table)
    {
        return this.all('PRAGMA table_info("' + table + '")').map((c) => c.name);
    }

    close ()
    {
        this.connection.close();
        instance = null;
    }
}

/**
 * Shared connection
 *
 * @return {Database}
 */
function db ()
{
    if (instance === null) {
        instance = new Database(process.env.TOS_DB ? path.resolve(process.env.TOS_DB) : DEFAULT_PATH);
    }

    return instance;
}

module.exports = { db, Database, DEFAULT_PATH };
