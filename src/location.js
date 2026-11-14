/**
 * Current (or last known) location of a character
 *
 * - instance: an encounter (dungeon, raid, world boss, PvP match) that is running right now and the character takes part in
 *             (encounter_start + encounter_duration in the future: the game keeps the duration up to date while it runs)
 * - position: the newest position (log_snapshot) with zone and coordinates
 * Offline characters get the last known position.
 */
'use strict';

const { now, sqlDate } = require('./util');

/**
 * @param {import('./db').Database} db
 * @param {number} character
 *
 * @return {{online:boolean, session:object|null, instance:object|null, zone:object|null, x:number|null, y:number|null, time:number|null, server:string|null, stale:boolean}}
 */
function locate (db, character)
{
    const t = now();

    const session = db.get(
        `SELECT log_play_time_id AS id, log_play_time_start AS start FROM log_play_time
         WHERE log_play_time_character = ? AND log_play_time_end IS NULL AND log_play_time_start > ?
         ORDER BY log_play_time_start DESC LIMIT 1`,
        character, t - 86400
    );

    const instance = session === null ? null : db.get(
        `SELECT e.encounter_id AS id, e.encounter_type AS type, e.encounter_difficulty AS difficulty, e.encounter_start AS start,
                i.instance_name AS name, pm.pvp_mode_name AS mode, m.encounter_member_team AS team
         FROM encounter_member m
         JOIN encounter e ON e.encounter_id = m.encounter_member_encounter
         LEFT JOIN instance i ON i.instance_id = e.encounter_instance
         LEFT JOIN pvp_mode pm ON pm.pvp_mode_id = i.instance_pvp_mode
         WHERE m.encounter_member_character = ? AND e.encounter_start <= ? AND e.encounter_start >= ?
           AND CAST(strftime('%s', e.encounter_start) AS INTEGER) + COALESCE(e.encounter_duration, 0) >= ?
         ORDER BY e.encounter_start DESC LIMIT 1`,
        character, sqlDate(t), sqlDate(t - 86400), t
    );

    const position = db.get(
        `SELECT s.log_snapshot_area AS zone, z.zone_name AS zoneName, z.zone_type AS zoneType, s.log_snapshot_location_x AS x,
                s.log_snapshot_location_y AS y, s.log_snapshot_time AS time, s.log_snapshot_session AS session
         FROM log_snapshot s LEFT JOIN zone z ON z.zone_id = s.log_snapshot_area
         WHERE s.log_snapshot_character = ? ORDER BY s.log_snapshot_time DESC LIMIT 1`,
        character
    );

    // without positions: the zone of the newest chat message or drop
    const fallback = position !== null ? null : db.get(
        `SELECT zone, zoneName, time FROM (
            SELECT m.chat_message_location AS zone, z.zone_name AS zoneName, m.chat_message_time AS time
            FROM chat_message m JOIN zone z ON z.zone_id = m.chat_message_location WHERE m.chat_message_character = ?
            UNION ALL
            SELECT g.log_gold_transaction_area, z.zone_name, g.log_gold_transaction_time
            FROM log_gold_transaction g JOIN zone z ON z.zone_id = g.log_gold_transaction_area WHERE g.log_gold_transaction_character = ?
         ) ORDER BY time DESC LIMIT 1`,
        character, character
    );

    // the newest instance/match of the character (for offline characters or as context)
    const lastInstance = instance !== null ? null : db.get(
        `SELECT e.encounter_id AS id, e.encounter_type AS type, e.encounter_start AS start, e.encounter_duration AS duration, i.instance_name AS name
         FROM encounter_member m JOIN encounter e ON e.encounter_id = m.encounter_member_encounter LEFT JOIN instance i ON i.instance_id = e.encounter_instance
         WHERE m.encounter_member_character = ? AND e.encounter_start <= ? ORDER BY e.encounter_start DESC LIMIT 1`,
        character, sqlDate(t)
    );

    // the last positions of the session (small map)
    const trail = position === null ? [] : db.all(
        'SELECT log_snapshot_location_x AS x, log_snapshot_location_y AS y FROM log_snapshot WHERE log_snapshot_session = ? AND log_snapshot_character = ? ORDER BY log_snapshot_time DESC LIMIT 40',
        position.session, character
    ).reverse();

    const server = db.value('SELECT s.server_name FROM character c LEFT JOIN server s ON s.server_id = c.character_server WHERE c.character_id = ?', character);
    const time = position?.time ?? fallback?.time ?? null;

    return {
        online: session !== null,
        session,
        instance,
        lastInstance,
        zone: position !== null ? { id: position.zone, name: position.zoneName, type: position.zoneType } : (fallback !== null ? { id: fallback.zone, name: fallback.zoneName } : null),
        x: position?.x ?? null,
        y: position?.y ?? null,
        time,
        trail,
        source: position !== null ? 'position' : (fallback !== null ? 'activity' : null),
        server,
        // position older than 5 minutes while online: the game did not send new positions
        stale: session !== null && time !== null && t - time > 300,
    };
}

module.exports = { locate };
