/**
 * Player statistics (rankings, player and character profiles)
 *
 * All values are calculated per character and then summed up per account.
 */
'use strict';

const { now, sqlDate, levelFromXp } = require('./util');

/** Gold sources that count as "earned" (trades and auctions only move gold between players) */
const EARNED = "('loot', 'quest', 'vendor')";

/**
 * Raw values per character
 *
 * @param {import('./db').Database} db
 * @param {number} since Start of the window (unix)
 * @param {{account?:number, character?:number}} filter
 *
 * @return {Map<number, object>}
 */
function characterValues (db, since, filter = {})
{
    const t = now();
    const since5 = t - 5 * 86400;
    const where = [];
    const params = [];

    if (filter.account !== undefined) {
        where.push('c.character_account = ?');
        params.push(filter.account);
    }

    if (filter.character !== undefined) {
        where.push('c.character_id = ?');
        params.push(filter.character);
    }

    const and = where.length > 0 ? ' AND ' + where.join(' AND ') : '';
    const values = new Map();
    const get = (id) => {
        let v = values.get(id);
        if (v === undefined) {
            v = {
                character: id, account: null, seconds: 0, sessions: 0, xp: 0, seconds5: 0, gold: 0, drops: 0,
                matches: 0, wins: 0, losses: 0, encounters: 0, sumDps: 0, peakDps: 0, sumHps: 0, peakHps: 0, peakDamage: 0, peakHealing: 0, maxApm: 0,
            };
            values.set(id, v);
        }

        return v;
    };

    for (const row of db.all(
        `SELECT c.character_id AS id, c.character_account AS account,
                SUM(MIN(COALESCE(p.log_play_time_end, ?), ?) - p.log_play_time_start) AS seconds,
                SUM(p.log_play_time_xp) AS xp, COUNT(*) AS sessions
         FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
         WHERE p.log_play_time_start >= ?` + and + ' GROUP BY c.character_id',
        t, t, since, ...params
    )) {
        Object.assign(get(row.id), { account: row.account, seconds: Math.max(0, row.seconds ?? 0), xp: row.xp ?? 0, sessions: row.sessions });
    }

    for (const row of db.all(
        `SELECT c.character_id AS id, c.character_account AS account,
                SUM(MIN(COALESCE(p.log_play_time_end, ?), ?) - MAX(p.log_play_time_start, ?)) AS seconds
         FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
         WHERE COALESCE(p.log_play_time_end, ?) > ?` + and + ' GROUP BY c.character_id',
        t, t, since5, t, since5, ...params
    )) {
        Object.assign(get(row.id), { account: row.account, seconds5: Math.max(0, row.seconds ?? 0) });
    }

    for (const row of db.all(
        `SELECT c.character_id AS id, c.character_account AS account, SUM(g.log_gold_transaction_amount) AS gold
         FROM log_gold_transaction g JOIN character c ON c.character_id = g.log_gold_transaction_character
         WHERE g.log_gold_transaction_time >= ? AND g.log_gold_transaction_sign = 1 AND g.log_gold_transaction_source IN ` + EARNED + and + `
         GROUP BY c.character_id`,
        since, ...params
    )) {
        Object.assign(get(row.id), { account: row.account, gold: row.gold ?? 0 });
    }

    for (const row of db.all(
        `SELECT c.character_id AS id, c.character_account AS account, COUNT(*) AS drops
         FROM log_item_transaction i JOIN character c ON c.character_id = i.log_item_transaction_character
         WHERE i.log_item_transaction_time >= ? AND i.log_item_transaction_source = 'loot'` + and + `
         GROUP BY c.character_id`,
        since, ...params
    )) {
        Object.assign(get(row.id), { account: row.account, drops: row.drops });
    }

    for (const row of db.all(
        `SELECT c.character_id AS id, c.character_account AS account,
                SUM(e.encounter_type = 'pvp') AS matches,
                SUM(e.encounter_type = 'pvp' AND e.encounter_winner = m.encounter_member_team) AS wins,
                SUM(e.encounter_type = 'pvp' AND e.encounter_winner IS NOT NULL AND e.encounter_winner != m.encounter_member_team) AS losses,
                COUNT(*) AS encounters,
                SUM(m.encounter_member_damage * 1.0 / NULLIF(e.encounter_duration, 0)) AS sumDps,
                MAX(m.encounter_member_damage * 1.0 / NULLIF(e.encounter_duration, 0)) AS peakDps,
                SUM(m.encounter_member_healing * 1.0 / NULLIF(e.encounter_duration, 0)) AS sumHps,
                MAX(m.encounter_member_healing * 1.0 / NULLIF(e.encounter_duration, 0)) AS peakHps,
                MAX(m.encounter_member_damage) AS peakDamage,
                MAX(m.encounter_member_healing) AS peakHealing,
                MAX(m.encounter_member_apm) AS maxApm
         FROM encounter_member m
         JOIN encounter e ON e.encounter_id = m.encounter_member_encounter
         JOIN character c ON c.character_id = m.encounter_member_character
         WHERE e.encounter_start >= ?` + and + ' GROUP BY c.character_id',
        sqlDate(since), ...params
    )) {
        Object.assign(get(row.id), {
            account: row.account, matches: row.matches ?? 0, wins: row.wins ?? 0, losses: row.losses ?? 0, encounters: row.encounters ?? 0,
            sumDps: row.sumDps ?? 0, peakDps: row.peakDps ?? 0, sumHps: row.sumHps ?? 0, peakHps: row.peakHps ?? 0,
            peakDamage: row.peakDamage ?? 0, peakHealing: row.peakHealing ?? 0, maxApm: row.maxApm ?? 0,
        });
    }

    return values;
}

/**
 * Sum up raw values (several characters -> account) and calculate the rates
 */
function combine (list)
{
    const v = {
        seconds: 0, sessions: 0, xp: 0, seconds5: 0, gold: 0, drops: 0, matches: 0, wins: 0, losses: 0, encounters: 0,
        sumDps: 0, peakDps: 0, sumHps: 0, peakHps: 0, peakDamage: 0, peakHealing: 0, maxApm: 0,
    };

    for (const item of list) {
        for (const key of ['seconds', 'sessions', 'xp', 'seconds5', 'gold', 'drops', 'matches', 'wins', 'losses', 'encounters', 'sumDps', 'sumHps']) {
            v[key] += item[key];
        }

        for (const key of ['peakDps', 'peakHps', 'peakDamage', 'peakHealing', 'maxApm']) {
            v[key] = Math.max(v[key], item[key]);
        }
    }

    const minutes = v.seconds / 60;

    return {
        playtime: v.seconds,
        playtime5: v.seconds5,
        sessions: v.sessions,
        xp: v.xp,
        gold: v.gold,
        drops: v.drops,
        goldPerMinute: minutes >= 1 ? v.gold / minutes : 0,
        xpPerMinute: minutes >= 1 ? v.xp / minutes : 0,
        dropsPerMinute: minutes >= 1 ? v.drops / minutes : 0,
        matches: v.matches,
        wins: v.wins,
        losses: v.losses,
        winRatio: v.losses > 0 ? v.wins / v.losses : (v.wins > 0 ? v.wins : 0),
        encounters: v.encounters,
        avgDps: v.encounters > 0 ? v.sumDps / v.encounters : 0,
        peakDps: v.peakDps,
        avgHps: v.encounters > 0 ? v.sumHps / v.encounters : 0,
        peakHps: v.peakHps,
        peakDamage: v.peakDamage,
        peakHealing: v.peakHealing,
        maxApm: v.maxApm,
    };
}

/**
 * Ranking of all accounts with activity in the window
 *
 * @param {import('./db').Database} db
 * @param {number} days
 */
function ranking (db, days)
{
    const since  = now() - days * 86400;
    const values = characterValues(db, since);
    const byAccount = new Map();

    for (const v of values.values()) {
        if (v.account === null) {
            continue;
        }

        if (!byAccount.has(v.account)) {
            byAccount.set(v.account, []);
        }

        byAccount.get(v.account).push(v);
    }

    const accounts = new Map(db.all(
        `SELECT a.account_id AS id, a.account_name AS name, a.account_status AS status, a.account_role AS role, a.account_muted_until AS muted,
                (SELECT COUNT(*) FROM mod_flag f WHERE f.mod_flag_account = a.account_id AND f.mod_flag_status = 'open') AS flags,
                (SELECT MAX(f.mod_flag_severity) FROM mod_flag f WHERE f.mod_flag_account = a.account_id AND f.mod_flag_status = 'open') AS severity
         FROM account a`
    ).map((a) => [a.id, a]));

    const rows = [];
    for (const [account, list] of byAccount) {
        const info = accounts.get(account);
        if (info === undefined) {
            continue;
        }

        rows.push({ account, name: info.name, status: info.status, role: info.role, muted: info.muted, flags: info.flags, severity: info.severity, ...combine(list) });
    }

    return rows;
}

/**
 * Statistics of one account (total + per character)
 */
function accountStats (db, account, days)
{
    const since  = now() - days * 86400;
    const values = [...characterValues(db, since, { account }).values()];

    return { total: combine(values), characters: Object.fromEntries(values.map((v) => [v.character, combine([v])])) };
}

function characterStats (db, character, days)
{
    const since  = now() - days * 86400;

    return combine([...characterValues(db, since, { character }).values()]);
}

/**
 * Activity per day (playtime, xp, gold, drops)
 *
 * @param {import('./db').Database} db
 * @param {{account?:number, character?:number}} filter
 * @param {number} days
 */
function daily (db, filter, days)
{
    const since = Math.floor(now() / 86400) * 86400 - (days - 1) * 86400;
    const where = filter.character !== undefined ? 'c.character_id = ?' : 'c.character_account = ?';
    const id    = filter.character ?? filter.account;
    const t     = now();
    const out   = new Map();

    for (let d = 0; d < days; ++d) {
        const date = sqlDate(since + d * 86400).slice(0, 10);
        out.set(date, { date, playtime: 0, xp: 0, gold: 0, drops: 0, chat: 0 });
    }

    const add = (rows, key) => {
        for (const row of rows) {
            const entry = out.get(row.day);
            if (entry !== undefined) {
                entry[key] = row.value ?? 0;
            }
        }
    };

    add(db.all(
        `SELECT date(p.log_play_time_start, 'unixepoch') AS day, SUM(MIN(COALESCE(p.log_play_time_end, ?), ?) - p.log_play_time_start) AS value
         FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
         WHERE p.log_play_time_start >= ? AND ` + where + ' GROUP BY day', t, t, since, id), 'playtime');
    add(db.all(
        `SELECT date(p.log_play_time_start, 'unixepoch') AS day, SUM(p.log_play_time_xp) AS value
         FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
         WHERE p.log_play_time_start >= ? AND ` + where + ' GROUP BY day', since, id), 'xp');
    add(db.all(
        `SELECT date(g.log_gold_transaction_time, 'unixepoch') AS day, SUM(g.log_gold_transaction_amount) AS value
         FROM log_gold_transaction g JOIN character c ON c.character_id = g.log_gold_transaction_character
         WHERE g.log_gold_transaction_time >= ? AND g.log_gold_transaction_sign = 1 AND g.log_gold_transaction_source IN ` + EARNED + ' AND ' + where + `
         GROUP BY day`, since, id), 'gold');
    add(db.all(
        `SELECT date(i.log_item_transaction_time, 'unixepoch') AS day, COUNT(*) AS value
         FROM log_item_transaction i JOIN character c ON c.character_id = i.log_item_transaction_character
         WHERE i.log_item_transaction_time >= ? AND i.log_item_transaction_source = 'loot' AND ` + where + ' GROUP BY day', since, id), 'drops');
    add(db.all(
        `SELECT date(m.chat_message_time, 'unixepoch') AS day, COUNT(*) AS value
         FROM chat_message m JOIN character c ON c.character_id = m.chat_message_character
         WHERE m.chat_message_time >= ? AND ` + where + ' GROUP BY day', since, id), 'chat');

    return [...out.values()];
}

/**
 * Playtime per hour of the day (last 14 days), shows bots that play around the clock
 */
function hourly (db, filter)
{
    const where = filter.character !== undefined ? 'c.character_id = ?' : 'c.character_account = ?';
    const id    = filter.character ?? filter.account;
    const t     = now();
    const hours = new Array(24).fill(0);

    for (const s of db.all(
        `SELECT p.log_play_time_start AS start, MIN(COALESCE(p.log_play_time_end, ?), ?) AS end
         FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
         WHERE p.log_play_time_start >= ? AND ` + where,
        t, t, t - 14 * 86400, id
    )) {
        for (let h = Math.floor(s.start / 3600); h * 3600 < s.end; ++h) {
            const from = Math.max(s.start, h * 3600);
            const to   = Math.min(s.end, (h + 1) * 3600);
            hours[h % 24] += Math.max(0, to - from) / 3600;
        }
    }

    return hours.map((v) => Math.round(v * 100) / 100);
}

module.exports = { ranking, accountStats, characterStats, daily, hourly, levelFromXp };
