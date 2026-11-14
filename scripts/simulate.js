/**
 * Live game activity simulator (development only)
 *
 * Usage: node scripts/simulate.js [path/to/TalesOfSouls.db]
 *
 * Writes chat messages, drops, trades and answers to support messages into the database while it runs, like the game
 * server would do. Start it next to the moderation tool to see the live pages move. Stop it with Ctrl+C.
 */
'use strict';

if (process.argv[2]) {
    process.env.TOS_DB = process.argv[2];
}

const { db: getDb } = require('../src/db');
const { migrate }   = require('../src/migrate');
const { now, sqlDate } = require('../src/util');
const fake = require('../src/fake');
const items = require('../src/items');
const { CHANNEL } = fake;

const db = getDb();
migrate(db);

const world = fake.loadWorld(db);
const ins   = fake.inserts(db);
const rnd   = Math.random;
const pick  = (list) => list[Math.floor(rnd() * list.length)];
const int   = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const characters = new Map(world.characters.map((c) => [c.id, c]));

const REPLIES = [
    'ok, sorry', 'thanks for the help!', 'I did not know that, it will not happen again', 'why me? the others did the same',
    'can you check it again please?', 'alright', 'thank you, it works now', 'I was not online at that time, someone else used my account?',
];

/**
 * Characters that are online right now (session without end)
 */
function online ()
{
    return db.all(
        `SELECT p.log_play_time_id AS session, p.log_play_time_character AS id, p.log_play_time_start AS start,
                (SELECT s.log_snapshot_area FROM log_snapshot s WHERE s.log_snapshot_session = p.log_play_time_id ORDER BY s.log_snapshot_time DESC LIMIT 1) AS zone
         FROM log_play_time p WHERE p.log_play_time_end IS NULL AND p.log_play_time_start > ?`,
        now() - 86400
    ).map((o) => ({ ...o, character: characters.get(o.id) })).filter((o) => o.character !== undefined);
}

function zoneOf (o)
{
    if (o.zone) {
        return world.zones.find((z) => z.id === o.zone) ?? world.zones[0];
    }

    return fake.zoneForLevel(world, o.character.level, () => (o.id % 97) / 97);
}

const bots = new Set(db.all("SELECT DISTINCT mod_flag_account AS account FROM mod_flag WHERE mod_flag_rule IN ('bot_path', 'drop_rate')").map((r) => r.account));

let tick = 0;
let players = online();

function step ()
{
    const t = now();
    ++tick;

    if (tick % 30 === 0) {
        players = online();
    }

    if (players.length === 0) {
        return;
    }

    db.transaction(() => {
        // positions: every 30 seconds a new position for every online character (a few steps away from the last one)
        if (tick % 30 === 15) {
            for (const o of players) {
                const last = db.get('SELECT log_snapshot_location_x AS x, log_snapshot_location_y AS y, log_snapshot_area AS zone FROM log_snapshot WHERE log_snapshot_session = ? ORDER BY log_snapshot_time DESC LIMIT 1', o.session);
                const zone = last?.zone ?? zoneOf(o).id;
                const x = Math.min(990, Math.max(10, (last?.x ?? int(100, 900)) + int(-90, 90)));
                const y = Math.min(990, Math.max(10, (last?.y ?? int(100, 900)) + int(-90, 90)));
                ins.snapshot({ x, y, zone, character: o.id, time: t, session: o.session });
            }
        }

        // now and then a group enters a dungeon (the encounter runs until its planned end)
        running = running.filter((r) => r.end > t);
        if (tick % 240 === 120) {
            const busy = new Set(running.flatMap((r) => r.members.map((m) => m.id)));
            const group = players.filter((o) => !busy.has(o.id) && !bots.has(o.character.account)).sort(() => rnd() - 0.5).slice(0, 5);
            const instance = db.get("SELECT instance_id AS id FROM instance WHERE instance_type = 'dungeon' ORDER BY RANDOM() LIMIT 1");
            if (group.length >= 3 && instance !== null) {
                const duration = int(900, 1500);
                const id = Number(db.run(
                    "INSERT INTO encounter (encounter_type, encounter_instance, encounter_difficulty, encounter_start, encounter_duration) VALUES ('dungeon', ?, 'Normal', ?, ?)",
                    instance.id, sqlDate(t), duration
                ).lastInsertRowid);
                group.forEach((o, i) => db.run(
                    'INSERT INTO encounter_member (encounter_member_encounter, encounter_member_character, encounter_member_team, encounter_member_role, encounter_member_damage, encounter_member_healing, encounter_member_apm) VALUES (?, ?, 1, ?, 0, 0, ?)',
                    id, o.id, i === 0 ? 'Tank' : (i === 1 ? 'Healer' : 'DPS'), int(40, 150)
                ));
                running.push({ id, members: group, end: t + duration });
            }
        }

        for (const r of running) {
            if (rnd() < 0.08) {
                const o = pick(r.members);
                ins.chat({ type: CHANNEL.PARTY, time: t, content: fake.chatText(CHANNEL.PARTY, rnd), character: o.id, server: o.character.server, encounter: r.id });
            }
        }

        // chat
        if (rnd() < 0.55) {
            const o = pick(players);
            const type = pick([CHANNEL.SAY, CHANNEL.ZONE, CHANNEL.ZONE, CHANNEL.TRADE, CHANNEL.GUILD, CHANNEL.PARTY, CHANNEL.WHISPER, CHANNEL.WORLD]);
            const toxic = rnd() < 0.04;
            ins.chat({
                type, time: t, content: toxic ? fake.toxicText(world, rnd) : fake.chatText(type, rnd), character: o.id, server: o.character.server,
                zone: zoneOf(o).id, to: type === CHANNEL.WHISPER ? pick(players).id : null,
            });
        }

        // gold and items
        for (let i = 0, n = int(1, 4); i < n; ++i) {
            const o = pick(players);
            const zone = zoneOf(o);
            const bot = bots.has(o.character.account);
            const mob = pick(world.mobs);
            const x = int(20, 980);
            const y = int(20, 980);

            ins.gold({
                time: t, character: o.id, server: o.character.server, zone: zone.id, x, y, sign: 1, source: rnd() < 0.85 ? 'loot' : 'quest',
                amount: bot ? int(150, 600) : int(5, 160), mob: mob.id, mobType: mob.category,
            });

            if (rnd() < (bot ? 0.9 : 0.35)) {
                let individual = null;
                let rarity = 1;
                if (rnd() < 0.1) {
                    rarity = pick([1, 1, 1, 2, 2, 3, 4, 5]);
                    const type = pick(world.equipment);
                    individual = ins.individual({ type: type.id, name: pick(['Worn', 'Fine', 'Runed']) + ' ' + type.name, rarity, level: o.character.level, character: o.id, created: sqlDate(t) });
                }

                // every drop is a new item with its own unique id
                items.createInstance(db, {
                    item: individual === null ? pick(world.items).id : null, individual, quantity: individual === null ? int(1, 3) : 1,
                    ownerType: 'character', owner: o.id, origin: 'loot', time: t, character: o.id, server: o.character.server,
                    logExtra: { zone: zone.id, x, y, rarity, mob: mob.id, mobType: mob.category },
                });
            }
        }

        // trades: start a new one now and then, finish the open ones
        if (tick % 15 === 0) {
            const a = pick(players);
            const b = pick(players);
            if (a.id !== b.id) {
                const trade = ins.trade({ character1: a.id, character2: b.id, gold2: int(20, 2000), state: 0, created: t, server: a.character.server, zone: zoneOf(a).id });
                ins.tradeItem({ trade, side: 1, item: pick(world.items).id, quantity: int(1, 15) });
            }
        }

        for (const trade of db.all('SELECT trade_transaction_id AS id, trade_transaction_created AS created, trade_transaction_character1 AS c1, trade_transaction_character2 AS c2, trade_transaction_gold2 AS gold FROM trade_transaction WHERE trade_transaction_state = 0')) {
            if (t - trade.created > int(8, 60)) {
                const completed = rnd() < 0.85;
                db.run('UPDATE trade_transaction SET trade_transaction_state = ?, trade_transaction_updated = ? WHERE trade_transaction_id = ?', completed ? 1 : 2, t, trade.id);
                if (completed && trade.gold > 0) {
                    ins.gold({ time: t, character: trade.c2, player: trade.c1, sign: -1, amount: trade.gold, source: 'trade' });
                    ins.gold({ time: t, character: trade.c1, player: trade.c2, sign: 1, amount: trade.gold, source: 'trade' });
                }
            }
        }

        // support: deliver the messages of the moderators and answer some of them
        for (const m of db.all('SELECT mod_support_message_id AS id, mod_support_message_account AS account, mod_support_message_character AS character, mod_support_message_time AS time FROM mod_support_message WHERE mod_support_message_direction = 0 AND mod_support_message_delivered = 0')) {
            if (t - m.time >= 2) {
                db.run('UPDATE mod_support_message SET mod_support_message_delivered = 1 WHERE mod_support_message_id = ?', m.id);
                if (rnd() < 0.8) {
                    pending.push({ at: t + int(6, 20), account: m.account, character: m.character });
                }
            }
        }

        for (const reply of pending.filter((p) => p.at <= t)) {
            ins.support({ account: reply.account, character: reply.character, direction: 1, content: pick(REPLIES), time: t, read: 0 });
        }

        pending = pending.filter((p) => p.at > t);

        // now and then a player reports another player
        if (tick % 90 === 45 && players.length > 1) {
            const reporter = pick(players);
            const target = pick(players);
            if (reporter.character.account !== target.character.account) {
                const category = pick(['cheating', 'botting', 'chat', 'harassment', 'other']);
                db.run(
                    `INSERT INTO player_report (player_report_reporter, player_report_reporter_character, player_report_account, player_report_character,
                        player_report_category, player_report_text, player_report_zone, player_report_server, player_report_created, player_report_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
                    reporter.character.account, reporter.id, target.character.account, target.id, category,
                    pick(['Please check this player', 'Looks like a bot to me', 'Very rude in chat', 'Too fast, must be cheating', 'Keeps following me']),
                    zoneOf(target).id, target.character.server, t
                );
            }
        }

        // now and then a player asks the support for help
        if (tick % 120 === 0) {
            const o = pick(players);
            ins.support({ account: o.character.account, character: o.id, direction: 1, time: t, read: 0,
                content: pick(['My mount is stuck under the bridge in ' + zoneOf(o).name + ', can you help?', 'I lost an item after the server restart', 'Someone is insulting me in the zone chat', 'Is the arena bugged? I can not join']) });
        }
    });
}

let pending = [];
let running = [];

console.log('Simulating live game activity in ' + db.file + ' (Ctrl+C to stop)');
const timer = setInterval(() => {
    try {
        step();
    } catch (error) {
        console.error(error.message);
    }
}, 1000);

process.on('SIGINT', () => {
    clearInterval(timer);
    db.close();
    process.exit(0);
});
