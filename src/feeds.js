/**
 * Chat messages, drops and trades with all names resolved (used by the lists and the live updates)
 */
'use strict';

const { badWords } = require('./detect');
const { thresholds } = require('./rules');

const CHANNELS = { 1: 'Say', 2: 'Zone', 3: 'Trade', 4: 'Guild', 5: 'Party', 6: 'Whisper', 7: 'World', 8: 'Raid', 9: 'Battleground' };
const TRADE_STATES = { 0: 'open', 1: 'completed', 2: 'cancelled' };

/**
 * Build a WHERE clause from filters
 */
function conditions (filters, map)
{
    const where = [];
    const params = [];

    for (const [key, value] of Object.entries(filters)) {
        if (value === null || value === undefined || value === '' || map[key] === undefined) {
            continue;
        }

        const [sql, transform] = Array.isArray(map[key]) ? map[key] : [map[key], (v) => v];
        where.push(sql);
        const p = transform(value);
        if (Array.isArray(p)) {
            params.push(...p);
        } else {
            params.push(p);
        }
    }

    return { where: where.length > 0 ? where.join(' AND ') : '1 = 1', params };
}

/**
 * @param {import('./db').Database} db
 * @param {{after?:number, before?:number, channel?:number, account?:number, character?:number, server?:number, zone?:number, q?:string, flagged?:boolean, since?:number}} filters
 * @param {number} limit
 */
function chat (db, filters = {}, limit = 100)
{
    const { where, params } = conditions(filters, {
        after: 'm.chat_message_id > ?',
        before: 'm.chat_message_id < ?',
        since: 'm.chat_message_time >= ?',
        channel: 'm.chat_message_type = ?',
        account: 'c.character_account = ?',
        character: ['(m.chat_message_character = ? OR m.chat_message_to = ?)', (v) => [v, v]],
        server: 'm.chat_message_server = ?',
        zone: 'm.chat_message_location = ?',
        q: ['(m.chat_message_content LIKE ? OR c.character_name LIKE ?)', (v) => ['%' + v + '%', '%' + v + '%']],
        flagged: ['m.chat_message_id IN (SELECT log_message_ref FROM log_message)', () => []],
        encounter: 'm.chat_message_encounter = ?',
    });

    const level = thresholds(db).chat_bad_word_level;
    const order = filters.after !== undefined || filters.idList !== undefined ? 'ASC' : 'DESC';
    let idSql = '';
    if (Array.isArray(filters.idList)) {
        if (filters.idList.length === 0) {
            return [];
        }

        idSql = ' AND m.chat_message_id IN (' + filters.idList.map(() => '?').join(',') + ')';
        params.push(...filters.idList.map(Number));
    }

    const rows = db.all(
        `SELECT m.chat_message_id AS id, m.chat_message_time AS time, m.chat_message_type AS channel, m.chat_message_content AS text,
                m.chat_message_language AS language, m.chat_message_character AS character, c.character_name AS characterName,
                c.character_account AS account, a.account_name AS accountName, a.account_muted_until AS muted, m.chat_message_to AS toCharacter,
                ct.character_name AS toName, m.chat_message_server AS server, s.server_name AS serverName, m.chat_message_location AS zone,
                z.zone_name AS zoneName, lm.log_message_review_action AS review, m.chat_message_encounter AS encounter,
                i.instance_name AS instanceName
         FROM chat_message m
         LEFT JOIN character c ON c.character_id = m.chat_message_character
         LEFT JOIN account a ON a.account_id = c.character_account
         LEFT JOIN character ct ON ct.character_id = m.chat_message_to
         LEFT JOIN server s ON s.server_id = m.chat_message_server
         LEFT JOIN zone z ON z.zone_id = m.chat_message_location
         LEFT JOIN log_message lm ON lm.log_message_ref = m.chat_message_id
         LEFT JOIN encounter e ON e.encounter_id = m.chat_message_encounter
         LEFT JOIN instance i ON i.instance_id = e.encounter_instance
         WHERE ` + where + idSql + `
         ORDER BY ` + (filters.idList !== undefined ? 'm.chat_message_time ASC, m.chat_message_id ASC' : 'm.chat_message_id ' + order) + `
         LIMIT ?`,
        ...params, limit
    );

    for (const row of rows) {
        row.channelName = CHANNELS[row.channel] ?? 'Unknown';
        row.badWords = badWords(db, row.text, level);
    }

    return order === 'ASC' && filters.idList === undefined ? rows.reverse() : rows;
}

/**
 * Gold and item drops (newest first)
 *
 * @param {{afterGold?:number, afterItem?:number, before?:number, account?:number, character?:number, zone?:number, type?:string, source?:string, minRarity?:number, minGold?:number, since?:number}} filters
 */
function drops (db, filters = {}, limit = 100)
{
    const out = [];
    const sources = filters.source ? [filters.source] : null;

    if (filters.type !== 'item') {
        const { where, params } = conditions({ ...filters, after: filters.afterGold }, {
            after: 'g.log_gold_transaction_id > ?',
            before: 'g.log_gold_transaction_time < ?',
            since: 'g.log_gold_transaction_time >= ?',
            account: 'c.character_account = ?',
            character: 'g.log_gold_transaction_character = ?',
            zone: 'g.log_gold_transaction_area = ?',
            minGold: 'g.log_gold_transaction_amount >= ?',
            encounter: 'g.log_gold_transaction_encounter = ?',
        });

        const sourceSql = sources === null ? " AND g.log_gold_transaction_source IN ('loot', 'quest', 'vendor')" : ' AND g.log_gold_transaction_source = ?';

        for (const row of db.all(
            `SELECT g.log_gold_transaction_id AS id, 'gold' AS type, g.log_gold_transaction_time AS time, g.log_gold_transaction_amount AS amount,
                    g.log_gold_transaction_source AS source, g.log_gold_transaction_character AS character, c.character_name AS characterName,
                    c.character_account AS account, a.account_name AS accountName, g.log_gold_transaction_area AS zone, z.zone_name AS zoneName,
                    g.log_gold_transaction_location_x AS x, g.log_gold_transaction_location_y AS y, mob.mob_name AS mobName,
                    g.log_gold_transaction_encounter AS encounter,
                    s.server_name AS serverName, g.log_gold_transaction_origin_player AS partner, cp.character_name AS partnerName
             FROM log_gold_transaction g
             LEFT JOIN character c ON c.character_id = g.log_gold_transaction_character
             LEFT JOIN account a ON a.account_id = c.character_account
             LEFT JOIN zone z ON z.zone_id = g.log_gold_transaction_area
             LEFT JOIN mob ON mob.mob_id = g.log_gold_transaction_origin_mob
             LEFT JOIN server s ON s.server_id = g.log_gold_transaction_server
             LEFT JOIN character cp ON cp.character_id = g.log_gold_transaction_origin_player
             WHERE g.log_gold_transaction_sign = 1 AND ` + where + sourceSql + `
             ORDER BY g.log_gold_transaction_id DESC LIMIT ?`,
            ...params, ...(sources ?? []), limit
        )) {
            out.push(row);
        }
    }

    if (filters.type !== 'gold' && !filters.minGold) {
        const { where, params } = conditions({ ...filters, after: filters.afterItem }, {
            after: 'i.log_item_transaction_id > ?',
            before: 'i.log_item_transaction_time < ?',
            since: 'i.log_item_transaction_time >= ?',
            account: 'c.character_account = ?',
            character: 'i.log_item_transaction_character = ?',
            zone: 'i.log_item_transaction_area = ?',
            encounter: 'i.log_item_transaction_encounter = ?',
            minRarity: 'COALESCE(ii.item_individual_rarity, i.log_item_transaction_rarity, 1) >= ?',
        });

        const sourceSql = sources === null ? " AND i.log_item_transaction_source = 'loot'" : ' AND i.log_item_transaction_source = ?';

        for (const row of db.all(
            `SELECT i.log_item_transaction_id AS id, 'item' AS type, i.log_item_transaction_time AS time, i.log_item_transaction_quantity AS amount,
                    i.log_item_transaction_source AS source, i.log_item_transaction_character AS character, c.character_name AS characterName,
                    c.character_account AS account, a.account_name AS accountName, i.log_item_transaction_area AS zone, z.zone_name AS zoneName,
                    i.log_item_transaction_location_x AS x, i.log_item_transaction_location_y AS y, mob.mob_name AS mobName,
                    i.log_item_transaction_encounter AS encounter, i.log_item_transaction_uid AS uid,
                    COALESCE(ii.item_individual_name, it.item_name, 'Unknown item') AS itemName, i.log_item_transaction_item AS item,
                    i.log_item_transaction_individual AS individual, COALESCE(ii.item_individual_rarity, i.log_item_transaction_rarity, 1) AS rarity,
                    r.item_rarity_name AS rarityName, ii.item_individual_level AS itemLevel, s.server_name AS serverName,
                    i.log_item_transaction_origin_player AS partner, cp.character_name AS partnerName
             FROM log_item_transaction i
             LEFT JOIN character c ON c.character_id = i.log_item_transaction_character
             LEFT JOIN account a ON a.account_id = c.character_account
             LEFT JOIN zone z ON z.zone_id = i.log_item_transaction_area
             LEFT JOIN mob ON mob.mob_id = i.log_item_transaction_origin_mob
             LEFT JOIN item it ON it.item_id = i.log_item_transaction_item
             LEFT JOIN item_individual ii ON ii.item_individual_id = i.log_item_transaction_individual
             LEFT JOIN item_rarity r ON r.item_rarity_id = COALESCE(ii.item_individual_rarity, i.log_item_transaction_rarity, 1)
             LEFT JOIN server s ON s.server_id = i.log_item_transaction_server
             LEFT JOIN character cp ON cp.character_id = i.log_item_transaction_origin_player
             WHERE i.log_item_transaction_sign = 1 AND ` + where + sourceSql + `
             ORDER BY i.log_item_transaction_id DESC LIMIT ?`,
            ...params, ...(sources ?? []), limit
        )) {
            out.push(row);
        }
    }

    out.sort((a, b) => b.time - a.time || (a.type < b.type ? -1 : 1) || b.id - a.id);

    return out.slice(0, limit);
}

/**
 * Trades incl. the items of both sides
 *
 * @param {{state?:number, account?:number, character?:number, updatedAfter?:number, before?:number, oneSided?:boolean, ids?:number[]}} filters
 */
function trades (db, filters = {}, limit = 100)
{
    const { where, params } = conditions(filters, {
        state: 't.trade_transaction_state = ?',
        account: ['(c1.character_account = ? OR c2.character_account = ?)', (v) => [v, v]],
        character: ['(t.trade_transaction_character1 = ? OR t.trade_transaction_character2 = ?)', (v) => [v, v]],
        updatedAfter: 't.trade_transaction_updated > ?',
        before: 't.trade_transaction_id < ?',
        minGold: ['MAX(t.trade_transaction_gold1, t.trade_transaction_gold2) >= ?', (v) => v],
        q: ['(c1.character_name LIKE ? OR c2.character_name LIKE ?)', (v) => ['%' + v + '%', '%' + v + '%']],
    });

    const rows = db.all(
        `SELECT t.trade_transaction_id AS id, t.trade_transaction_state AS state, t.trade_transaction_created AS created,
                t.trade_transaction_updated AS updated, t.trade_transaction_gold1 AS gold1, t.trade_transaction_gold2 AS gold2,
                t.trade_transaction_character1 AS character1, c1.character_name AS name1, c1.character_account AS account1, a1.account_name AS accountName1,
                t.trade_transaction_character2 AS character2, c2.character_name AS name2, c2.character_account AS account2, a2.account_name AS accountName2,
                z.zone_name AS zoneName, s.server_name AS serverName
         FROM trade_transaction t
         LEFT JOIN character c1 ON c1.character_id = t.trade_transaction_character1
         LEFT JOIN character c2 ON c2.character_id = t.trade_transaction_character2
         LEFT JOIN account a1 ON a1.account_id = c1.character_account
         LEFT JOIN account a2 ON a2.account_id = c2.character_account
         LEFT JOIN zone z ON z.zone_id = t.trade_transaction_area
         LEFT JOIN server s ON s.server_id = t.trade_transaction_server
         WHERE ` + where + `
         ORDER BY ` + (filters.updatedAfter !== undefined ? 't.trade_transaction_updated ASC' : 't.trade_transaction_id DESC') + `
         LIMIT ?`,
        ...params, limit
    );

    if (rows.length === 0) {
        return rows;
    }

    const items = db.all(
        `SELECT ti.trade_transaction_item_trade AS trade, ti.trade_transaction_item_side AS side, ti.trade_transaction_item_quantity AS quantity,
                COALESCE(ii.item_individual_name, it.item_name, 'Unknown item') AS name, COALESCE(ii.item_individual_rarity, 1) AS rarity
         FROM trade_transaction_item ti
         LEFT JOIN item it ON it.item_id = ti.trade_transaction_item_item
         LEFT JOIN item_individual ii ON ii.item_individual_id = ti.trade_transaction_item_individual
         WHERE ti.trade_transaction_item_trade IN (` + rows.map(() => '?').join(',') + ')',
        ...rows.map((r) => r.id)
    );

    const th = thresholds(db).trade_one_sided_gold;
    for (const row of rows) {
        row.stateName = TRADE_STATES[row.state] ?? 'unknown';
        row.items1 = items.filter((i) => i.trade === row.id && i.side === 1);
        row.items2 = items.filter((i) => i.trade === row.id && i.side === 2);
        row.oneSided = (row.gold1 >= th && row.gold2 === 0 && row.items2.length === 0)
            || (row.gold2 >= th && row.gold1 === 0 && row.items1.length === 0);
    }

    return rows;
}

module.exports = { chat, drops, trades, CHANNELS, TRADE_STATES };
