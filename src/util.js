'use strict';

/**
 * Unix timestamp (seconds)
 *
 * @return {number}
 */
function now ()
{
    return Math.floor(Date.now() / 1000);
}

/**
 * Unix timestamp -> "YYYY-MM-DD HH:MM:SS" (UTC), the format of the website tables
 *
 * @param {number} ts
 * @return {string}
 */
function sqlDate (ts)
{
    return new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * "YYYY-MM-DD HH:MM:SS" (UTC) -> unix timestamp
 *
 * @param {string|null} text
 * @return {number|null}
 */
function parseSqlDate (text)
{
    if (text === null || text === undefined || text === '') {
        return null;
    }

    const ts = Date.parse(String(text).replace(' ', 'T') + 'Z');

    return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

let xpTable = null;

/**
 * Level from the total xp (same calculation as the website: player_level holds the xp needed per level)
 *
 * @param {import('./db').Database} db
 * @param {number} xp
 * @return {number}
 */
function levelFromXp (db, xp)
{
    if (xpTable === null) {
        xpTable = db.all('SELECT player_level_id AS id, player_level_xp AS xp FROM player_level ORDER BY player_level_id')
            .map((row) => parseInt(String(row.xp).replace(/[^0-9]/g, ''), 10) || 0);
    }

    let level = 1;
    let rest  = Number(xp) || 0;
    for (let i = 0; i < xpTable.length; ++i) {
        if (rest < xpTable[i]) {
            break;
        }

        rest -= xpTable[i];
        level = i + 2;
    }

    return Math.min(level, Math.max(1, xpTable.length));
}

/**
 * Median of a list of numbers
 *
 * @param {number[]} values
 * @return {number}
 */
function median (values)
{
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Mean and standard deviation
 *
 * @param {number[]} values
 * @return {{mean:number, std:number}}
 */
function meanStd (values)
{
    if (values.length === 0) {
        return { mean: 0, std: 0 };
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;

    return { mean, std: Math.sqrt(variance) };
}

/**
 * Seeded random number generator (mulberry32)
 *
 * @param {number} seed
 * @return {() => number}
 */
function random (seed)
{
    let a = seed >>> 0;

    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

module.exports = { now, sqlDate, parseSqlDate, levelFromXp, median, meanStd, random };
