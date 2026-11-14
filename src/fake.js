/**
 * Dummy game activity, used by the seed script (history) and the simulator (live data)
 *
 * In production the game server writes these rows, the moderation tool only reads them.
 */
'use strict';

const { levelFromXp } = require('./util');

const CHANNEL = { SAY: 1, ZONE: 2, TRADE: 3, GUILD: 4, PARTY: 5, WHISPER: 6, WORLD: 7, RAID: 8, BATTLEGROUND: 9 };

const PHRASES = {
    [CHANNEL.SAY]: [
        'hi', 'hello there', 'anyone know where the blacksmith is?', 'thanks!', 'nice gear', 'brb', 'lol',
        'how do I get to the next zone?', 'gg', 'that boss hits hard', 'is this the right quest giver?',
        'need help with the troll camp', 'wow that was close', 'sorry, my bad', 'ty for the heal',
    ],
    [CHANNEL.ZONE]: [
        'LFG troll camp quest', 'anyone up for the elite?', 'where do the wolves spawn?', 'world boss up at the ruins!',
        'is the merchant in the north still there?', 'group for the cave, need healer', 'rare spawn near the lake',
        'how long until the event starts?', 'who is killing all the boars lol', 'any tips for the jumping puzzle?',
    ],
    [CHANNEL.TRADE]: [
        'WTS Iron Ore x20, pst', 'WTB Moonleaf, paying well', 'selling crafted boots, whisper me', 'WTS enchanting service',
        'buying herbs in bulk', 'WTT my blue sword for a shield', 'cheap potions at the auction house',
        'LF tailor to craft a cape', 'WTS 50 fish, good price', 'anyone selling leather?',
    ],
    [CHANNEL.GUILD]: [
        'raid tonight at 8', 'gz on the level!', 'who needs the guild bank?', 'thanks for the run everyone',
        'can someone invite my friend?', 'great job yesterday', 'new rank system is live', 'need 2 dps for the dungeon',
        'I will be offline tomorrow', 'anyone want to do achievements?',
    ],
    [CHANNEL.PARTY]: [
        'pull when ready', 'wait for mana', 'tank swap', 'stack here', 'kill the adds first', 'nice', 'ready?',
        'one more run?', 'I have to go after this', 'drink break',
    ],
    [CHANNEL.WHISPER]: [
        'hey, still selling the ore?', 'sure, 50g?', 'deal', 'thanks for the trade', 'want to group?',
        'can you help me with a quest?', 'invite me pls', 'sorry, busy right now',
    ],
    [CHANNEL.RAID]: [
        'everyone ready?', 'pull in 10', 'tanks swap at 3 stacks', 'healers watch the fire', 'nice kill!', 'wipe it, reset', 'who has the key?',
        'loot council after the boss', 'bloodlust on pull', 'stack for the meteor', 'gg, next boss', 'need a battle res', 'remember the adds at 30%',
    ],
    [CHANNEL.BATTLEGROUND]: [
        'defend the flag!', 'two coming mid', 'healer first', 'go go go', 'they have no healer', 'gg', 'push left',
        'focus the mage', 'wait for respawn', 'nice one', 'cap the point', 'incoming south',
    ],
    [CHANNEL.WORLD]: [
        'server lag?', 'when is the next update?', 'gz to whoever got the first kill!', 'is the arena down?',
        'anyone from germany here?', 'what class is best for pvp?', 'patch notes are out', 'good morning everyone',
    ],
};

const TOXIC = [
    'you are such an {w}', 'uninstall the game you {w}', 'learn to play {w}', 'shut up {w}', '{w} healer again',
    'report this {w}', 'what a {w} team', 'go back to tutorial {w}',
];

const SPAM = [
    'WTS cheap gold 100k = 5$ !!! visit g0ldk1ng dot com',
    'Fast power leveling 1-60 in 2 days, safe and cheap, g0ldk1ng dot com',
    'Buy gold now, 10% discount code TOS, g0ldk1ng dot com',
];

const MOBS_BY_ZONE_TYPE = {
    field: [3, 4],
    dungeon: [3],
    town: [1, 4],
    pvp: [2],
};

/**
 * Player characters (main character per account + info that is needed for the dummy data)
 *
 * @param {import('./db').Database} db
 */
function loadWorld (db)
{
    const zones = db.all('SELECT zone_id AS id, zone_name AS name, zone_type AS type, zone_level_min AS min, zone_level_max AS max FROM zone ORDER BY zone_id');
    const items = db.all('SELECT item_id AS id, item_name AS name FROM item WHERE item_name IS NOT NULL ORDER BY item_id');
    const mobs  = db.all('SELECT mob_id AS id, mob_name AS name, mob_category AS category FROM mob WHERE mob_name IS NOT NULL ORDER BY mob_id');
    const skills = db.all('SELECT skill_id AS id FROM skill ORDER BY skill_id').map((s) => s.id);
    const equipment = db.all('SELECT equipment_type_id AS id, equipment_type_name AS name FROM equipment_type ORDER BY equipment_type_id');
    const badWords = db.all("SELECT bad_word_dictionary_word AS word FROM bad_word_dictionary WHERE bad_word_dictionary_word NOT LIKE '% %' AND LENGTH(bad_word_dictionary_word) BETWEEN 4 AND 9 ORDER BY bad_word_dictionary_id").map((w) => w.word);

    const characters = db.all(
        `SELECT c.character_id AS id, c.character_account AS account, c.character_name AS name, c.character_xp AS xp,
                c.character_server AS server, c.character_season AS season, c.character_dead AS dead, a.account_name AS accountName,
                a.account_role AS role
         FROM character c
         JOIN account a ON a.account_id = c.character_account
         WHERE c.character_account IS NOT NULL
         ORDER BY c.character_id`
    ).map((c) => ({ ...c, level: levelFromXp(db, c.xp ?? 0) }));

    const byAccount = new Map();
    for (const c of characters) {
        if (!byAccount.has(c.account)) {
            byAccount.set(c.account, []);
        }

        byAccount.get(c.account).push(c);
    }

    const accounts = [];
    for (const [id, list] of byAccount) {
        const alive = list.filter((c) => !c.dead);
        const main  = (alive.length > 0 ? alive : list).sort((a, b) => b.xp - a.xp)[0];
        accounts.push({ id, name: main.accountName, role: main.role, characters: list, main });
    }

    accounts.sort((a, b) => a.id - b.id);

    return { zones, items, mobs, skills, equipment, badWords, characters, accounts };
}

/**
 * Zone that fits the level of a character
 */
function zoneForLevel (world, level, rnd)
{
    const fitting = world.zones.filter((z) => z.type === 'field' && level >= z.min - 2 && level <= z.max + 2);
    const list    = fitting.length > 0 ? fitting : world.zones.filter((z) => z.type === 'field');

    return list[Math.floor(rnd() * list.length)];
}

function pick (list, rnd)
{
    return list[Math.floor(rnd() * list.length)];
}

/**
 * Chat message text of a normal player
 */
function chatText (channel, rnd)
{
    return pick(PHRASES[channel] ?? PHRASES[CHANNEL.SAY], rnd);
}

function toxicText (world, rnd)
{
    const words = world.badWords.length > 0 ? world.badWords.slice(0, 12) : ['idiot'];

    return pick(TOXIC, rnd).replace('{w}', pick(words, rnd));
}

/**
 * Prepared insert statements
 *
 * @param {import('./db').Database} db
 */
function inserts (db)
{
    return {
        chat: (m) => db.run(
            `INSERT INTO chat_message (chat_message_type, chat_message_time, chat_message_to, chat_message_content, chat_message_language,
                chat_message_character, chat_message_server, chat_message_location, chat_message_encounter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            m.type, m.time, m.to ?? null, m.content, m.language ?? 'en', m.character, m.server ?? null, m.zone ?? null, m.encounter ?? null
        ),

        gold: (g) => db.run(
            `INSERT INTO log_gold_transaction (log_gold_transaction_origin_mob_type, log_gold_transaction_origin_player, log_gold_transaction_origin_mob,
                log_gold_transaction_time, log_gold_transaction_sign, log_gold_transaction_location_x, log_gold_transaction_location_y,
                log_gold_transaction_location_z, log_gold_transaction_area, log_gold_transaction_character, log_gold_transaction_amount,
                log_gold_transaction_source, log_gold_transaction_server, log_gold_transaction_encounter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            g.mobType ?? null, g.player ?? null, g.mob ?? null, g.time, g.sign ?? 1, g.x ?? null, g.y ?? null, g.z ?? 0,
            g.zone ?? null, g.character, g.amount, g.source, g.server ?? null, g.encounter ?? null
        ),

        item: (i) => db.run(
            `INSERT INTO log_item_transaction (log_item_transaction_origin_mob_type, log_item_transaction_origin_player, log_item_transaction_time,
                log_item_transaction_sign, log_item_transaction_location_x, log_item_transaction_location_y, log_item_transaction_location_z,
                log_item_transaction_area, log_item_transaction_character, log_item_transaction_item, log_item_transaction_individual,
                log_item_transaction_quantity, log_item_transaction_rarity, log_item_transaction_source, log_item_transaction_origin_mob,
                log_item_transaction_server) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            i.mobType ?? null, i.player ?? null, i.time, i.sign ?? 1, i.x ?? null, i.y ?? null, i.z ?? 0, i.zone ?? null,
            i.character, i.item ?? null, i.individual ?? null, i.quantity ?? 1, i.rarity ?? 1, i.source, i.mob ?? null, i.server ?? null
        ),

        individual: (e) => Number(db.run(
            `INSERT INTO item_individual (item_individual_equipment_type, item_individual_name, item_individual_rarity, item_individual_level,
                item_individual_character, item_individual_created) VALUES (?, ?, ?, ?, ?, ?)`,
            e.type, e.name, e.rarity, e.level, e.character, e.created
        ).lastInsertRowid),

        trade: (t) => Number(db.run(
            `INSERT INTO trade_transaction (trade_transaction_character1, trade_transaction_character2, trade_transaction_gold1,
                trade_transaction_gold2, trade_transaction_state, trade_transaction_created, trade_transaction_updated,
                trade_transaction_server, trade_transaction_area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            t.character1, t.character2, t.gold1 ?? 0, t.gold2 ?? 0, t.state ?? 0, t.created, t.updated ?? t.created, t.server ?? null, t.zone ?? null
        ).lastInsertRowid),

        tradeItem: (ti) => db.run(
            `INSERT INTO trade_transaction_item (trade_transaction_item_trade, trade_transaction_item_side, trade_transaction_item_item,
                trade_transaction_item_individual, trade_transaction_item_quantity) VALUES (?, ?, ?, ?, ?)`,
            ti.trade, ti.side, ti.item ?? null, ti.individual ?? null, ti.quantity ?? 1
        ),

        session: (s) => Number(db.run(
            `INSERT INTO log_play_time (log_play_time_start, log_play_time_end, log_play_time_character, log_play_time_xp, log_play_time_server)
             VALUES (?, ?, ?, ?, ?)`,
            s.start, s.end ?? null, s.character, s.xp ?? 0, s.server ?? null
        ).lastInsertRowid),

        snapshot: (p) => db.run(
            `INSERT INTO log_snapshot (log_snapshot_location_x, log_snapshot_location_y, log_snapshot_location_z, log_snapshot_orientation_x,
                log_snapshot_orientation_y, log_snapshot_area, log_snapshot_xp, log_snapshot_gold, log_snapshot_action, log_snapshot_character,
                log_snapshot_time, log_snapshot_session) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            p.x, p.y, p.ox ?? 0, p.oy ?? 0, p.zone, p.xp ?? null, p.gold ?? null, p.action ?? 0, p.character, p.time, p.session
        ),

        input: (s) => db.run(
            'INSERT INTO log_skill_input (log_skill_input_character, log_skill_input_skill, log_skill_input_time, log_skill_input_encounter) VALUES (?, ?, ?, ?)',
            s.character, s.skill, s.time, s.encounter ?? null
        ),

        auth: (a) => db.run(
            `INSERT INTO log_auth (log_auth_time, log_auth_status, log_auth_account, log_auth_end, log_auth_hardware, log_auth_ip, log_auth_origin)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            a.time, a.status ?? 1, a.account, a.end ?? null, a.hardware, a.ip, a.origin ?? 'client'
        ),

        auction: (a) => Number(db.run(
            `INSERT INTO auction (auction_character, auction_prize_min, auction_prize_now, auction_duration, auction_start, auction_item,
                auction_quantity, auction_state, auction_end, auction_server) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            a.character, a.price, a.price, a.duration, a.start, a.item, a.quantity, a.state, a.end ?? null, a.server ?? null
        ).lastInsertRowid),

        auctionSale: (s) => db.run(
            `INSERT INTO auction_transaction (auction_transaction_auction, auction_transaction_buyer, auction_transaction_quantity,
                auction_transaction_datetime) VALUES (?, ?, ?, ?)`,
            s.auction, s.buyer, s.quantity, s.time
        ),

        support: (m) => db.run(
            `INSERT INTO mod_support_message (mod_support_message_account, mod_support_message_character, mod_support_message_moderator,
                mod_support_message_direction, mod_support_message_content, mod_support_message_time, mod_support_message_read,
                mod_support_message_delivered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            m.account, m.character ?? null, m.moderator ?? null, m.direction, m.content, m.time, m.read ?? 0, m.delivered ?? 1
        ),
    };
}

/**
 * Walk between points of interest (humans) or along a fixed loop (bots)
 *
 * @return {{x:number, y:number}[]} positions every `step` seconds
 */
function walk (waypoints, seconds, step, speed, rnd, jitter)
{
    const out = [];
    let index = 0;
    let x = waypoints[0][0];
    let y = waypoints[0][1];

    for (let t = 0; t <= seconds; t += step) {
        out.push({ x: Math.round((x + (rnd() - 0.5) * jitter) * 10) / 10, y: Math.round((y + (rnd() - 0.5) * jitter) * 10) / 10 });

        let budget = speed * step;
        while (budget > 0) {
            const target = waypoints[(index + 1) % waypoints.length];
            const dx = target[0] - x;
            const dy = target[1] - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= budget) {
                x = target[0];
                y = target[1];
                budget -= dist;
                index = (index + 1) % waypoints.length;
            } else {
                x += dx / dist * budget;
                y += dy / dist * budget;
                budget = 0;
            }
        }
    }

    return out;
}

module.exports = { CHANNEL, PHRASES, SPAM, MOBS_BY_ZONE_TYPE, loadWorld, zoneForLevel, pick, chatText, toxicText, inserts, walk };
