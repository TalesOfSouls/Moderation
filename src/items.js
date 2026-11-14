/**
 * Item instances
 *
 * Every item that exists in the game world is a row in item_instance with a unique identifier (uid). A stack of
 * 20 ore is one instance with quantity 20, every piece of equipment is one instance (+ item_individual for its stats).
 * Every change of an instance is logged in log_item_transaction (with the uid), so the history of an item can be
 * traced and duplicated items (same uid twice, items without origin) can be detected.
 *
 * Owners / containers:
 *   character + backpack  inventory of a character
 *   account   + stash     stash shared by all characters of an account
 *   guild     + vault     guild vault
 */
'use strict';

const crypto = require('node:crypto');
const { now } = require('./util');

const CONTAINERS = { character: 'backpack', account: 'stash', guild: 'vault' };

function uid ()
{
    return crypto.randomUUID();
}

/**
 * Create an item instance (+ log entry)
 *
 * @param {import('./db').Database} db
 * @param {{item?:number|null, individual?:number|null, quantity?:number, ownerType:string, owner:number, container?:string,
 *          origin:string, originRef?:string|null, time?:number, uid?:string, character?:number|null, server?:number|null, log?:boolean}} data
 *
 * @return {{id:number, uid:string}}
 */
function createInstance (db, data)
{
    const id   = data.uid ?? uid();
    const time = data.time ?? now();
    const instance = Number(db.run(
        `INSERT INTO item_instance (item_instance_uid, item_instance_item, item_instance_individual, item_instance_quantity, item_instance_owner_type,
            item_instance_owner, item_instance_container, item_instance_created, item_instance_origin, item_instance_origin_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, data.item ?? null, data.individual ?? null, data.quantity ?? 1, data.ownerType, data.owner,
        data.container ?? CONTAINERS[data.ownerType], time, data.origin, data.originRef ?? null
    ).lastInsertRowid);

    if (data.log !== false) {
        logItem(db, {
            ...(data.logExtra ?? {}),
            time, character: data.character ?? (data.ownerType === 'character' ? data.owner : null), sign: 1, item: data.item ?? null,
            individual: data.individual ?? null, quantity: data.quantity ?? 1, source: data.origin, uid: id, server: data.server ?? null,
        });
    }

    return { id: instance, uid: id };
}

/**
 * Log entry of an item change (zone/position/mob are optional: where a drop happened)
 */
function logItem (db, l)
{
    db.run(
        `INSERT INTO log_item_transaction (log_item_transaction_time, log_item_transaction_sign, log_item_transaction_character,
            log_item_transaction_item, log_item_transaction_individual, log_item_transaction_quantity, log_item_transaction_source,
            log_item_transaction_uid, log_item_transaction_server, log_item_transaction_origin_player, log_item_transaction_rarity,
            log_item_transaction_area, log_item_transaction_location_x, log_item_transaction_location_y, log_item_transaction_location_z,
            log_item_transaction_origin_mob, log_item_transaction_origin_mob_type, log_item_transaction_encounter)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        l.time ?? now(), l.sign, l.character ?? null, l.item ?? null, l.individual ?? null, l.quantity ?? 1, l.source, l.uid ?? null,
        l.server ?? null, l.player ?? null, l.rarity ?? null, l.zone ?? null, l.x ?? null, l.y ?? null, l.z ?? null, l.mob ?? null, l.mobType ?? null,
        l.encounter ?? null
    );
}

const SELECT = `
    SELECT ii.item_instance_id AS id, ii.item_instance_uid AS uid, ii.item_instance_item AS item, ii.item_instance_individual AS individual,
           ii.item_instance_quantity AS quantity, ii.item_instance_owner_type AS ownerType, ii.item_instance_owner AS owner,
           ii.item_instance_container AS container, ii.item_instance_slot AS slot, ii.item_instance_created AS created,
           ii.item_instance_origin AS origin, ii.item_instance_origin_ref AS originRef, ii.item_instance_deleted AS deleted,
           ii.item_instance_deleted_reason AS deletedReason, dm.account_name AS deletedByName,
           COALESCE(iv.item_individual_name, it.item_name, 'Unknown item') AS name, COALESCE(iv.item_individual_rarity, 1) AS rarity,
           iv.item_individual_level AS level, et.equipment_type_name AS equipmentType, ity.item_type_name AS typeName,
           CASE ii.item_instance_owner_type
                WHEN 'character' THEN (SELECT character_name FROM character WHERE character_id = ii.item_instance_owner)
                WHEN 'account' THEN (SELECT account_name FROM account WHERE account_id = ii.item_instance_owner)
                WHEN 'guild' THEN (SELECT guild_name FROM guild WHERE guild_id = ii.item_instance_owner)
           END AS ownerName,
           (SELECT COUNT(*) FROM item_instance x WHERE x.item_instance_uid = ii.item_instance_uid AND x.item_instance_deleted IS NULL) AS copies,
           EXISTS (SELECT 1 FROM log_item_transaction l WHERE l.log_item_transaction_uid = ii.item_instance_uid AND l.log_item_transaction_sign = 1) AS hasOrigin,
           (SELECT SUM(l.log_item_transaction_quantity) FROM log_item_transaction l WHERE l.log_item_transaction_uid = ii.item_instance_uid AND l.log_item_transaction_sign = 1) AS added
    FROM item_instance ii
    LEFT JOIN item it ON it.item_id = ii.item_instance_item
    LEFT JOIN item_type ity ON ity.item_type_id = it.item_type
    LEFT JOIN item_individual iv ON iv.item_individual_id = ii.item_instance_individual
    LEFT JOIN equipment_type et ON et.equipment_type_id = iv.item_individual_equipment_type
    LEFT JOIN account dm ON dm.account_id = ii.item_instance_deleted_by`;

/**
 * Items of an owner
 */
function inventory (db, ownerType, owner, includeDeleted = false)
{
    return db.all(
        SELECT + ` WHERE ii.item_instance_owner_type = ? AND ii.item_instance_owner = ?` + (includeDeleted ? '' : ' AND ii.item_instance_deleted IS NULL') + `
         ORDER BY ii.item_instance_container, COALESCE(iv.item_individual_rarity, 1) DESC, name`,
        ownerType, owner
    );
}

function instance (db, id)
{
    return db.get(SELECT + ' WHERE ii.item_instance_id = ?', id);
}

/**
 * Everything known about a uid: all instances (also deleted ones), the log and trades/auctions
 */
function trace (db, value)
{
    const instances = db.all(SELECT + ' WHERE ii.item_instance_uid = ? ORDER BY ii.item_instance_id', value);
    const log = db.all(
        `SELECT l.log_item_transaction_id AS id, l.log_item_transaction_time AS time, l.log_item_transaction_sign AS sign,
                l.log_item_transaction_quantity AS quantity, l.log_item_transaction_source AS source, l.log_item_transaction_character AS character,
                c.character_name AS characterName, c.character_account AS account, a.account_name AS accountName,
                l.log_item_transaction_origin_player AS partner, cp.character_name AS partnerName, z.zone_name AS zoneName
         FROM log_item_transaction l
         LEFT JOIN character c ON c.character_id = l.log_item_transaction_character
         LEFT JOIN account a ON a.account_id = c.character_account
         LEFT JOIN character cp ON cp.character_id = l.log_item_transaction_origin_player
         LEFT JOIN zone z ON z.zone_id = l.log_item_transaction_area
         WHERE l.log_item_transaction_uid = ? ORDER BY l.log_item_transaction_time, l.log_item_transaction_id`,
        value
    );
    const trades = db.all(
        `SELECT t.trade_transaction_id AS id, t.trade_transaction_state AS state, t.trade_transaction_updated AS time,
                t.trade_transaction_character1 AS character1, c1.character_name AS name1, t.trade_transaction_character2 AS character2,
                c2.character_name AS name2, ti.trade_transaction_item_side AS side
         FROM trade_transaction_item ti
         JOIN trade_transaction t ON t.trade_transaction_id = ti.trade_transaction_item_trade
         LEFT JOIN character c1 ON c1.character_id = t.trade_transaction_character1
         LEFT JOIN character c2 ON c2.character_id = t.trade_transaction_character2
         WHERE ti.trade_transaction_item_uid = ? ORDER BY t.trade_transaction_updated`,
        value
    );

    return { uid: value, instances, log, trades };
}

/**
 * Remove (a part of) an instance. The row is kept (marked deleted) for the history.
 */
function remove (db, id, quantity, moderator, reason)
{
    const item = db.get(
        `SELECT item_instance_id AS id, item_instance_uid AS uid, item_instance_quantity AS quantity, item_instance_item AS item,
                item_instance_individual AS individual, item_instance_owner_type AS ownerType, item_instance_owner AS owner, item_instance_deleted AS deleted
         FROM item_instance WHERE item_instance_id = ?`,
        id
    );

    if (item === null || item.deleted !== null) {
        return null;
    }

    const amount = Math.min(item.quantity, Math.max(1, Math.floor(quantity || item.quantity)));
    const t = now();

    if (amount >= item.quantity) {
        db.run('UPDATE item_instance SET item_instance_deleted = ?, item_instance_deleted_by = ?, item_instance_deleted_reason = ? WHERE item_instance_id = ?', t, moderator, reason, id);
    } else {
        db.run('UPDATE item_instance SET item_instance_quantity = item_instance_quantity - ? WHERE item_instance_id = ?', amount, id);
    }

    logItem(db, {
        time: t, sign: -1, character: item.ownerType === 'character' ? item.owner : null, item: item.item, individual: item.individual,
        quantity: amount, source: 'moderation', uid: item.uid,
    });

    return { ...item, removed: amount, remaining: item.quantity - amount };
}

module.exports = { uid, createInstance, logItem, inventory, instance, trace, remove, CONTAINERS };
