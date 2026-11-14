/**
 * Dummy data for the moderation tool
 *
 * Usage: node scripts/seed.js [path/to/TalesOfSouls.db]
 *
 * Fills the (empty) game log tables of TalesOfSouls.db with the activity of the last 14 days, relative to *now*:
 * play sessions, logins, chat, gold/item drops, trades, auctions, PvP matches, positions and skill inputs.
 * A few accounts behave suspiciously on purpose (bot farm, gold seller, win traders, ...) so the detection can be tested.
 *
 * Running it again replaces the data of the previous run. Accounts, characters and the website data are not changed
 * (except the item_individual rows of equipment drops and the PvP matches created by this script).
 */
'use strict';

if (process.argv[2]) {
    process.env.TOS_DB = process.argv[2];
}

const { db: getDb } = require('../src/db');
const { migrate }   = require('../src/migrate');
const { now, sqlDate, random } = require('../src/util');
const items = require('../src/items');
const fake = require('../src/fake');
const { CHANNEL } = fake;

const db  = getDb();
const rnd = random(20261023);

const NOW          = now();
const DAY          = 86400;
const HISTORY_DAYS = 14;
const PATH_DAYS    = 2;

migrate(db);

// rows this script creates in tables of the website (PvP matches, dropped equipment), so a new run can remove them
db.exec('CREATE TABLE IF NOT EXISTS "mod_seed_row" ("mod_seed_row_table" TEXT, "mod_seed_row_id" INTEGER)');
const remember = (table, id) => db.run('INSERT INTO mod_seed_row (mod_seed_row_table, mod_seed_row_id) VALUES (?, ?)', table, id);

const world = fake.loadWorld(db);
const ins   = fake.inserts(db);

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

const between = (a, b) => a + rnd() * (b - a);
const int     = (a, b) => Math.floor(between(a, b + 1));
const chance  = (p) => rnd() < p;
const pick    = (list) => list[Math.floor(rnd() * list.length)];

function poisson (lambda)
{
    if (lambda > 30) {
        return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
    }

    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
        ++k;
        p *= rnd();
    } while (p > limit);

    return k - 1;
}

function gauss ()
{
    const u = Math.max(rnd(), 1e-9);
    const v = rnd();

    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function lognormal (mean, sigma)
{
    return mean * Math.exp(sigma * gauss() - sigma * sigma / 2);
}

function hex (n)
{
    let out = '';
    for (let i = 0; i < n; ++i) {
        out += Math.floor(rnd() * 16).toString(16);
    }

    return out;
}

const zoneById = new Map(world.zones.map((z) => [z.id, z]));
const mobsByCategory = new Map();
for (const mob of world.mobs) {
    if (!mobsByCategory.has(mob.category)) {
        mobsByCategory.set(mob.category, []);
    }

    mobsByCategory.get(mob.category).push(mob);
}

function randomMob (zone)
{
    const categories = fake.MOBS_BY_ZONE_TYPE[zone.type] ?? [3];
    const list = mobsByCategory.get(pick(categories)) ?? world.mobs;

    return pick(list);
}

/** Points of interest per zone (humans walk between them in random order) */
const POI = new Map(world.zones.map((z) => [z.id, Array.from({ length: 40 }, () => [int(20, 980), int(20, 980)])]));

// ---------------------------------------------------------------------------------------------------------------------
// remove the data of the previous run
// ---------------------------------------------------------------------------------------------------------------------

function clear ()
{
    db.run("DELETE FROM encounter_attempt WHERE encounter_attempt_boss IN (SELECT encounter_boss_id FROM encounter_boss WHERE encounter_boss_encounter IN (SELECT mod_seed_row_id FROM mod_seed_row WHERE mod_seed_row_table = 'encounter'))");
    db.run("DELETE FROM encounter_boss WHERE encounter_boss_encounter IN (SELECT mod_seed_row_id FROM mod_seed_row WHERE mod_seed_row_table = 'encounter')");
    db.run("DELETE FROM encounter_member WHERE encounter_member_encounter IN (SELECT mod_seed_row_id FROM mod_seed_row WHERE mod_seed_row_table = 'encounter')");
    db.run("DELETE FROM encounter WHERE encounter_id IN (SELECT mod_seed_row_id FROM mod_seed_row WHERE mod_seed_row_table = 'encounter')");
    db.run("DELETE FROM item_individual WHERE item_individual_id IN (SELECT mod_seed_row_id FROM mod_seed_row WHERE mod_seed_row_table = 'item_individual')");
    db.run('DELETE FROM mod_seed_row');

    for (const table of [
        'chat_message', 'log_message', 'log_gold_transaction', 'log_item_transaction', 'trade_transaction', 'trade_transaction_item',
        'log_play_time', 'log_snapshot', 'log_skill_input', 'log_auth', 'auction', 'auction_bid', 'auction_transaction',
        'mod_flag', 'mod_support_message', 'mod_action', 'item_instance', 'character_quest', 'character_quest_step', 'player_report',
    ]) {
        db.run('DELETE FROM "' + table + '"');
        db.run('DELETE FROM sqlite_sequence WHERE name = ?', table);
    }

    db.run('UPDATE account SET account_muted_until = NULL, account_report_blocked_until = NULL');
}

// ---------------------------------------------------------------------------------------------------------------------
// accounts and their behavior
// ---------------------------------------------------------------------------------------------------------------------

const players = world.accounts.filter((a) => a.role === 0 && a.name !== 'tester');

/** suspicious accounts (fixed positions in the account list, so the result is the same for every run) */
const ROLES = {
    bot: [players[20], players[21], players[22]],
    xp: players[30],
    toxic: players[40],
    seller: players[50],
    winner: players[60],
    loser: players[61],
    scripter: players[70],
    ahSeller: players[80],
    ahBuyer: players[81],
    undercut: players[82],
    sniper: players[83],
    duper: players[90],
    duperPartner: players[91],
    falseReporter: players[95],
    harassed: players[96],
};

const suspicious = new Set([
    ...ROLES.bot, ROLES.xp, ROLES.toxic, ROLES.seller, ROLES.winner, ROLES.loser, ROLES.scripter,
    ROLES.ahSeller, ROLES.ahBuyer, ROLES.undercut, ROLES.sniper, ROLES.duper, ROLES.duperPartner, ROLES.falseReporter,
].filter(Boolean).map((a) => a.id));

const BOT_HARDWARE = 'HW-' + hex(12);
const BOT_IP       = '185.220.' + int(1, 254) + '.' + int(1, 254);
const BOT_ZONE     = world.zones.find((z) => z.name === 'Ironpeak Mines') ?? world.zones[1];
const BOT_ROUTE    = [[120, 140], [260, 120], [400, 180], [520, 160], [640, 260], [600, 420], [470, 480], [330, 450], [200, 380], [110, 260]];

const profiles = new Map();
for (const account of players) {
    const level = account.main.level;
    profiles.set(account.id, {
        active: chance(0.8),
        dayChance: between(0.35, 0.9),
        sessionsPerDay: between(1, 2.2),
        minutes: [int(20, 45), int(90, 220)],
        goldRate: between(12, 42) * (0.6 + level / 120),
        xpRate: between(9000, 42000) * (0.7 + level / 120),
        dropRate: between(0.05, 0.22),
        chatRate: between(0.02, 0.12),
        toxicChance: chance(0.15) ? 0.03 : 0,
        hardware: 'HW-' + hex(12),
        ip: int(10, 220) + '.' + int(0, 255) + '.' + int(0, 255) + '.' + int(1, 254),
        online: chance(0.25),
    });
}

// a family: two accounts on one computer (below the threshold of 3, should not be flagged)
if (players[5] && players[6]) {
    profiles.get(players[6].id).hardware = profiles.get(players[5].id).hardware;
    profiles.get(players[6].id).ip = profiles.get(players[5].id).ip;
}

for (const bot of ROLES.bot) {
    Object.assign(profiles.get(bot.id), {
        active: true, hardware: BOT_HARDWARE, ip: BOT_IP, goldRate: between(175, 210), dropRate: between(4.5, 5.5), chatRate: 0, online: true,
    });
}

Object.assign(profiles.get(ROLES.toxic.id), { active: true, dayChance: 1, toxicChance: 0.45, chatRate: 0.25, online: true });
Object.assign(profiles.get(ROLES.scripter.id), { active: true, dayChance: 1 });
Object.assign(profiles.get(ROLES.seller.id), { active: true, dayChance: 1, chatRate: 0, online: true });

// ---------------------------------------------------------------------------------------------------------------------
// sessions with gold, items, chat, positions and skill inputs
// ---------------------------------------------------------------------------------------------------------------------

const stats = { sessions: 0, gold: 0, items: 0, chat: 0, snapshots: 0, inputs: 0, trades: 0, auctions: 0, matches: 0 };
const onlineCharacters = [];
const sessionsByAccount = new Map();

function addChat (character, time, type, content, zone, to = null)
{
    ins.chat({ type, time, to, content, character: character.id, server: character.server, zone });
    ++stats.chat;
}

/**
 * Position of a character at a time (interpolated from the path of the session, random if no path)
 */
function positionAt (path, start, time, step)
{
    if (path === null || path.length === 0) {
        return { x: int(20, 980), y: int(20, 980) };
    }

    const index = Math.min(path.length - 1, Math.max(0, Math.floor((time - start) / step)));

    return path[index];
}

function skillInputs (character, start, seconds, mode, encounter = null)
{
    const skills = [];
    for (let i = 0; i < 6; ++i) {
        skills.push(world.skills[(character.id * 7 + i * 13) % world.skills.length]);
    }

    let t = start * 1000;
    const end = (start + seconds) * 1000;

    if (mode === 'script') {
        // fixed rotation, nearly identical timing, plus some inhumanly fast double presses
        const rotation = [skills[0], skills[1], skills[2], skills[1], skills[3]];
        let i = 0;
        while (t < end) {
            ins.input({ character: character.id, skill: rotation[i % rotation.length], time: Math.round(t), encounter });
            ++stats.inputs;
            if (i % 9 === 4) {
                t += between(28, 45);
                ins.input({ character: character.id, skill: skills[4], time: Math.round(t), encounter });
                ++stats.inputs;
            }

            t += 450 + between(-12, 12);
            ++i;
            if (i % 40 === 0) {
                t += 3000;
            }
        }

        return;
    }

    if (mode === 'bot') {
        const rotation = [skills[0], skills[2], skills[0], skills[5]];
        let i = 0;
        while (t < end) {
            ins.input({ character: character.id, skill: rotation[i % rotation.length], time: Math.round(t), encounter });
            ++stats.inputs;
            t += 1200 + between(-25, 25);
            ++i;
            if (i % 24 === 0) {
                t += 6000 + between(-30, 30);
            }
        }

        return;
    }

    // human: irregular, favorite combos, pauses
    let previous = skills[0];
    while (t < end) {
        const next = chance(0.5) ? skills[(skills.indexOf(previous) + 1) % skills.length] : pick(skills);
        ins.input({ character: character.id, skill: next, time: Math.round(t), encounter });
        ++stats.inputs;
        previous = next;
        t += chance(0.07) ? between(2500, 9000) : lognormal(760, 0.45) + 90;
    }
}

function simulateSession (account, profile, character, start, minutes, options = {})
{
    const end     = start + minutes * 60;
    const ongoing = end > NOW;
    const zone    = options.zone ?? fake.zoneForLevel(world, character.level, rnd);
    const xpRate  = options.xpRate ?? profile.xpRate;
    const played  = Math.min(end, NOW) - start;

    const session = ins.session({
        start, end: ongoing ? null : end, character: character.id, server: character.server,
        xp: Math.round(xpRate * played / 3600 * between(0.85, 1.15)),
    });
    ++stats.sessions;

    ins.auth({ time: start - int(5, 60), account: account.id, end: ongoing ? null : end + int(1, 30), hardware: profile.hardware, ip: profile.ip });

    if (!sessionsByAccount.has(account.id)) {
        sessionsByAccount.set(account.id, []);
    }

    sessionsByAccount.get(account.id).push({ start, end: Math.min(end, NOW), character, zone });

    if (ongoing) {
        onlineCharacters.push(character.id);
    }

    // positions (only recent sessions, it is a lot of data)
    const step = 30;
    let path   = null;
    if (options.path || ongoing || (start > NOW - PATH_DAYS * DAY && (options.pathAlways || chance(0.45)))) {
        // humans: a long list of random places (no loop), bots: the same few waypoints again and again
        const route = options.route ?? Array.from({ length: 400 }, () => pick(POI.get(zone.id)));
        path = fake.walk(route, played, step, options.route ? 4 : between(2.5, 4.5), rnd, options.route ? 1.5 : 30);
        path = path.slice(0, 1200);

        for (let i = 0; i < path.length; ++i) {
            ins.snapshot({ ...path[i], zone: zone.id, character: character.id, time: start + i * step, session, action: 0 });
            ++stats.snapshots;
        }
    }

    // skill inputs (one fight block per recent session)
    if (start > NOW - PATH_DAYS * DAY && (options.inputs || chance(0.35))) {
        const fightStart = start + int(60, Math.max(61, Math.floor(played / 3)));
        skillInputs(character, fightStart, Math.min(options.inputSeconds ?? int(60, 240), Math.max(30, played - 60)), options.inputMode ?? 'human');
    }

    // gold
    const goldEvents = poisson(minutes * 0.35 * (options.goldEventFactor ?? 1));
    const goldTotal  = profile.goldRate * played / 60;
    for (let i = 0; i < goldEvents; ++i) {
        const time = start + int(0, Math.max(1, played));
        const pos  = positionAt(path, start, time, step);
        const roll = rnd();
        const source = roll < 0.75 ? 'loot' : (roll < 0.9 ? 'quest' : 'vendor');
        const mob  = source === 'loot' ? randomMob(zone) : null;
        ins.gold({
            time, character: character.id, server: character.server, zone: zone.id, x: pos.x, y: pos.y, sign: 1, source,
            amount: Math.max(1, Math.round(goldTotal / goldEvents * between(0.3, 1.7) * (source === 'quest' ? 2.5 : 1))),
            mob: mob?.id ?? null, mobType: mob?.category ?? null,
        });
        ++stats.gold;
    }

    for (let i = 0, spend = poisson(minutes / 60); i < spend; ++i) {
        ins.gold({
            time: start + int(0, Math.max(1, played)), character: character.id, server: character.server, zone: zone.id, sign: -1,
            source: pick(['repair', 'vendor', 'travel']), amount: int(20, 400),
        });
        ++stats.gold;
    }

    // items
    const drops = poisson(profile.dropRate * played / 60 * (options.dropFactor ?? 1));
    for (let i = 0; i < drops; ++i) {
        const time = start + int(0, Math.max(1, played));
        const pos  = positionAt(path, start, time, step);
        const mob  = randomMob(zone);
        let individual = null;
        let rarity = 1;
        let item = pick(world.items).id;

        if (chance(0.1)) {
            const roll = rnd();
            rarity = roll < 0.55 ? 1 : (roll < 0.8 ? 2 : (roll < 0.93 ? 3 : (roll < 0.98 ? 4 : (roll < 0.995 ? 5 : 6))));
            const type = pick(world.equipment);
            individual = ins.individual({
                type: type.id, name: pick(['Worn', 'Sturdy', 'Fine', 'Ironbound', 'Frostforged', 'Runed', 'Ancient']) + ' ' + type.name,
                rarity, level: Math.max(1, character.level + int(-3, 2)), character: character.id, created: sqlDate(time),
            });
            remember('item_individual', individual);
            item = null;
        }

        ins.item({
            time, character: character.id, server: character.server, zone: zone.id, x: pos.x, y: pos.y, source: 'loot',
            item, individual, quantity: individual === null ? int(1, 4) : 1, rarity, mob: mob.id, mobType: mob.category,
        });
        ++stats.items;
    }

    // chat
    const messages = poisson(minutes * profile.chatRate);
    for (let i = 0; i < messages; ++i) {
        const time = start + int(0, Math.max(1, played));
        const type = pick([CHANNEL.SAY, CHANNEL.SAY, CHANNEL.ZONE, CHANNEL.ZONE, CHANNEL.TRADE, CHANNEL.GUILD, CHANNEL.PARTY, CHANNEL.WHISPER, CHANNEL.WORLD]);
        const content = chance(profile.toxicChance) ? fake.toxicText(world, rnd) : fake.chatText(type, rnd);
        const to = type === CHANNEL.WHISPER ? pick(world.characters).id : null;
        addChat(character, time, type, content, zone.id, to);
    }
}

/**
 * Normal play: sessions spread over the days, more in the evening
 */
function playNormal (account, profile)
{
    if (!profile.active) {
        return;
    }

    const alts = account.characters.filter((c) => c.id !== account.main.id && !c.dead);

    for (let day = HISTORY_DAYS; day >= 0; --day) {
        if (!chance(profile.dayChance) && !(day === 0 && profile.online)) {
            continue;
        }

        const dayStart = Math.floor((NOW - day * DAY) / DAY) * DAY;
        let cursor = dayStart + int(7, 15) * 3600 + int(0, 3599);
        const count = Math.max(1, Math.round(profile.sessionsPerDay * between(0.6, 1.3)));

        for (let s = 0; s < count; ++s) {
            const minutes   = int(profile.minutes[0], profile.minutes[1]);
            const character = alts.length > 0 && chance(0.2) ? pick(alts) : account.main;

            if (cursor > NOW) {
                break;
            }

            simulateSession(account, profile, character, cursor, minutes);
            cursor += minutes * 60 + int(1, 5) * 3600;
        }
    }

    // currently online
    if (profile.online) {
        const last = sessionsByAccount.get(account.id)?.at(-1);
        if (last === undefined || last.end < NOW - 1800) {
            simulateSession(account, profile, account.main, NOW - int(10, 110) * 60, int(120, 240));
        }
    }
}

/**
 * Bot farm: three accounts on the same computer, ~21 hours a day on the same route
 */
function playBot (account, profile)
{
    const route = BOT_ROUTE.map(([x, y]) => [x + (account.id % 3) * 3, y]);

    for (let day = HISTORY_DAYS; day >= 0; --day) {
        const dayStart = Math.floor((NOW - day * DAY) / DAY) * DAY;
        const recent   = day <= 5;

        if (!recent) {
            // before it became a bot: normal casual play
            if (chance(0.5)) {
                simulateSession(account, { ...profile, goldRate: 30, dropRate: 0.3 }, account.main, dayStart + int(16, 20) * 3600, int(40, 120));
            }

            continue;
        }

        // three blocks of ~7 hours with short breaks (restarts)
        for (let block = 0; block < 3; ++block) {
            const start = dayStart + block * 8 * 3600 + int(5, 25) * 60;
            if (start > NOW) {
                break;
            }

            // only the last 2 days with all item drops (the drop rule looks at the analysis window), keeps the database small
            simulateSession(account, profile, account.main, start, int(400, 450), {
                zone: BOT_ZONE, route, pathAlways: day <= 2, path: day <= 2, inputs: day <= 1, inputMode: 'bot', inputSeconds: 600, xpRate: 26000,
                dropFactor: day <= 1 ? 1 : 0.06,
            });
        }
    }
}

db.transaction(() => {
    clear();

    for (const account of players) {
        const profile = profiles.get(account.id);
        if (ROLES.bot.includes(account)) {
            playBot(account, profile);
        } else {
            playNormal(account, profile);
        }
    }

    // admins/developers play a little bit too
    for (const account of world.accounts.filter((a) => a.role > 0)) {
        const profile = { active: true, dayChance: 0.3, sessionsPerDay: 1, minutes: [20, 60], goldRate: 25, xpRate: 15000, dropRate: 0.2, chatRate: 0.05, toxicChance: 0, hardware: 'HW-' + hex(12), ip: '10.0.0.' + int(2, 250), online: false };
        playNormal(account, profile);
    }

    // xp exploit: the last two days ~10 times the normal xp rate
    {
        const account = ROLES.xp;
        const profile = profiles.get(account.id);
        for (let i = 0; i < 4; ++i) {
            simulateSession(account, profile, account.main, NOW - (44 - i * 11) * 3600, int(90, 150), { xpRate: between(260000, 340000), inputs: true });
        }
    }

    // scripter: many PvP matches with perfect input timing (added below), plays every day
    // gold seller: spam, one-sided trades (below)
});

// ---------------------------------------------------------------------------------------------------------------------
// chat: toxic player and spammer
// ---------------------------------------------------------------------------------------------------------------------

db.transaction(() => {
    const toxic = ROLES.toxic.main;
    for (let i = 0; i < 14; ++i) {
        addChat(toxic, NOW - int(60, 20 * 3600), pick([CHANNEL.ZONE, CHANNEL.WORLD, CHANNEL.PARTY]), fake.toxicText(world, rnd), fake.zoneForLevel(world, toxic.level, rnd).id);
    }

    const seller = ROLES.seller.main;
    const tradeZone = world.zones.find((z) => z.name === 'Highmere') ?? world.zones[0];
    simulateSession(ROLES.seller, profiles.get(ROLES.seller.id), seller, NOW - 5 * 3600, 400, { zone: tradeZone, dropFactor: 0, goldEventFactor: 0 });
    for (let i = 0; i < 36; ++i) {
        addChat(seller, NOW - 2 * 3600 + i * 95 + int(0, 20), pick([CHANNEL.TRADE, CHANNEL.WORLD]), fake.SPAM[Math.floor(i / 12) % fake.SPAM.length], tradeZone.id);
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// trades
// ---------------------------------------------------------------------------------------------------------------------

db.transaction(() => {
    const activeAccounts = players.filter((a) => (sessionsByAccount.get(a.id) ?? []).length > 0 && !suspicious.has(a.id));

    const logTradeTransfers = (trade, a, b, goldA, goldB, itemsA, itemsB, time, zone) => {
        const transfer = (from, to, gold, items) => {
            if (gold > 0) {
                ins.gold({ time, character: from.id, player: to.id, sign: -1, amount: gold, source: 'trade', zone, server: from.server });
                ins.gold({ time, character: to.id, player: from.id, sign: 1, amount: gold, source: 'trade', zone, server: to.server });
            }

            for (const item of items) {
                ins.item({ time, character: from.id, player: to.id, sign: -1, item: item.item, quantity: item.quantity, source: 'trade', zone, server: from.server });
                ins.item({ time, character: to.id, player: from.id, sign: 1, item: item.item, quantity: item.quantity, source: 'trade', zone, server: to.server });
            }
        };

        transfer(a, b, goldA, itemsA);
        transfer(b, a, goldB, itemsB);
    };

    const createTrade = (a, b, time, state, goldA, goldB, itemsA, itemsB, zone) => {
        const trade = ins.trade({
            character1: a.id, character2: b.id, gold1: goldA, gold2: goldB, state, created: time,
            updated: state === 0 ? time : time + int(10, 180), server: a.server, zone,
        });

        for (const item of itemsA) {
            ins.tradeItem({ trade, side: 1, item: item.item, quantity: item.quantity });
        }

        for (const item of itemsB) {
            ins.tradeItem({ trade, side: 2, item: item.item, quantity: item.quantity });
        }

        if (state === 1) {
            logTradeTransfers(trade, a, b, goldA, goldB, itemsA, itemsB, time, zone);
        }

        ++stats.trades;

        return trade;
    };

    // normal trades: items for (roughly fair) gold
    for (let i = 0; i < 320; ++i) {
        const a = pick(activeAccounts).main;
        const b = pick(activeAccounts).main;
        if (a.id === b.id) {
            continue;
        }

        const time   = NOW - int(60, HISTORY_DAYS * DAY);
        const items  = Array.from({ length: int(1, 3) }, () => ({ item: pick(world.items).id, quantity: int(1, 20) }));
        const price  = Math.round(items.reduce((s, it) => s + it.quantity * between(5, 120), 0));
        const roll   = rnd();
        const state  = roll < 0.88 ? 1 : 2;
        const zone   = pick(world.zones.filter((z) => z.type === 'town')).id;

        createTrade(a, b, time, state, 0, price, items, chance(0.15) ? [{ item: pick(world.items).id, quantity: 1 }] : [], zone);
    }

    // open trades (in progress right now)
    for (let i = 0; i < 6; ++i) {
        const a = pick(activeAccounts).main;
        const b = pick(activeAccounts).main;
        if (a.id !== b.id) {
            createTrade(a, b, NOW - int(5, 90), 0, 0, int(50, 900), [{ item: pick(world.items).id, quantity: int(1, 10) }], [], world.zones[0].id);
        }
    }

    // gold seller: large amounts of gold for nothing (the payment happens outside of the game)
    const seller = ROLES.seller.main;
    for (let i = 0; i < 9; ++i) {
        const buyer = pick(activeAccounts).main;
        createTrade(seller, buyer, NOW - int(600, 3 * DAY), 1, int(8, 25) * 10000, 0, [], [], world.zones[0].id);
    }

    // the seller gets the gold from the bot farm
    for (const bot of ROLES.bot) {
        for (let i = 0; i < 3; ++i) {
            createTrade(bot.main, seller, NOW - int(3600, 4 * DAY), 1, int(15, 30) * 10000, 0, [], [], world.zones[0].id);
        }
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// auction house
// ---------------------------------------------------------------------------------------------------------------------

db.transaction(() => {
    const goods  = world.items.slice(0, 400).filter((_, i) => i % 6 === 0).slice(0, 60);
    const prices = new Map(goods.map((g) => [g.id, Math.round(lognormal(180, 0.9)) + 5]));
    const sellers = players.filter((a) => !suspicious.has(a.id));

    const auction = (character, item, unitPrice, quantity, start, sold, buyer = null, buyDelay = null) => {
        const duration = pick([12, 24, 48]) * 3600;
        const ended    = start + duration < NOW;
        const state    = sold ? 1 : (ended ? 2 : 0);
        const id = ins.auction({
            character: character.id, price: Math.round(unitPrice * quantity), duration, start, item, quantity, state,
            end: sold ? start + (buyDelay ?? int(60, duration - 60)) : (ended ? start + duration : null), server: character.server,
        });

        if (sold) {
            ins.auctionSale({ auction: id, buyer: (buyer ?? pick(sellers).main).id, quantity, time: start + (buyDelay ?? int(60, Math.min(duration, NOW - start) - 1)) });
        }

        ++stats.auctions;

        return id;
    };

    for (let i = 0; i < 700; ++i) {
        const item = pick(goods);
        const start = NOW - int(600, HISTORY_DAYS * DAY);
        const quantity = int(1, 10);
        const open = start + 24 * 3600 > NOW;
        auction(pick(sellers).main, item.id, prices.get(item.id) * between(0.7, 1.45), quantity, start, !open && chance(0.65));
    }

    // gold transfer: junk listed for 25-40 times the usual price, always bought by the same friend
    for (let i = 0; i < 5; ++i) {
        const item = pick(goods);
        auction(ROLES.ahSeller.main, item.id, prices.get(item.id) * between(25, 40), 1, NOW - int(3600, 3 * DAY), true, ROLES.ahBuyer.main, int(20, 90));
    }

    // underpriced auctions that are bought within seconds by the same character (item transfer / bot sniping)
    for (let i = 0; i < 6; ++i) {
        const item = pick(goods);
        auction(ROLES.undercut.main, item.id, prices.get(item.id) * between(0.03, 0.08), int(5, 10), NOW - int(3600, 4 * DAY), true, ROLES.sniper.main, int(2, 8));
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// PvP matches
// ---------------------------------------------------------------------------------------------------------------------

db.transaction(() => {
    const instances = db.all("SELECT instance_id AS id, instance_pvp_mode AS mode FROM instance WHERE instance_type = 'pvp' AND instance_pvp_mode IN (1, 2, 4)");
    const modes     = new Map(db.all('SELECT pvp_mode_id AS id, pvp_mode_name AS name, pvp_mode_size AS size FROM pvp_mode').map((m) => [m.id, m]));
    const pvpPlayers = players.filter((a) => !suspicious.has(a.id) && (sessionsByAccount.get(a.id) ?? []).length > 0).map((a) => a.main);

    const match = (start, duration, instance, team1, team2, winner, options = {}) => {
        const mode = modes.get(instance.mode);
        const encounter = Number(db.run(
            `INSERT INTO encounter (encounter_type, encounter_instance, encounter_difficulty, encounter_start, encounter_duration, encounter_success,
                encounter_winner, encounter_score1, encounter_score2) VALUES ('pvp', ?, ?, ?, ?, NULL, ?, ?, ?)`,
            instance.id, mode.name, sqlDate(start), duration, winner,
            winner === 1 ? 3 : int(0, 2), winner === 2 ? 3 : int(0, 2)
        ).lastInsertRowid);
        remember('encounter', encounter);

        for (const [team, members] of [[1, team1], [2, team2]]) {
            for (const c of members) {
                const special = options.members?.[c.id] ?? {};
                const dps  = special.dps ?? between(900, 3600);
                const hps  = special.hps ?? (chance(0.25) ? between(800, 2600) : between(50, 400));
                const apm  = special.apm ?? between(35, 170);
                const damage  = Math.round(dps * duration);
                const healing = Math.round(hps * duration);
                db.run(
                    `INSERT INTO encounter_member (encounter_member_encounter, encounter_member_character, encounter_member_team, encounter_member_role,
                        encounter_member_damage, encounter_member_damage_single, encounter_member_damage_aoe, encounter_member_healing,
                        encounter_member_healing_single, encounter_member_healing_aoe, encounter_member_healing_received, encounter_member_damage_taken,
                        encounter_member_deaths, encounter_member_kills, encounter_member_assists, encounter_member_objectives, encounter_member_casts,
                        encounter_member_apm, encounter_member_cooldown_usage, encounter_member_active, encounter_member_rating_before,
                        encounter_member_rating_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    encounter, c.id, team, hps > 700 ? 'Healer' : 'DPS', damage, Math.round(damage * 0.7), Math.round(damage * 0.3), healing,
                    Math.round(healing * 0.8), Math.round(healing * 0.2), int(1000, 50000), int(1000, 60000), int(0, 6), int(0, 8), int(0, 12), 0,
                    Math.round(apm * duration / 60), Math.round(apm * 10) / 10, int(40, 95), int(70, 99), int(1200, 2100),
                    team === winner ? int(8, 22) : -int(8, 22)
                );
            }
        }

        ++stats.matches;

        return encounter;
    };

    const team = (size, exclude) => {
        const out = [];
        while (out.length < size) {
            const c = pick(pvpPlayers);
            if (!exclude.has(c.id)) {
                exclude.add(c.id);
                out.push(c);
            }
        }

        return out;
    };

    // normal matches
    for (let i = 0; i < 160; ++i) {
        const instance = pick(instances);
        const size     = modes.get(instance.mode).size;
        const used     = new Set();
        match(NOW - int(1800, 7 * DAY), int(240, 1500), instance, team(size, used), team(size, used), chance(0.5) ? 1 : 2);
    }

    // win trading: the same two accounts meet again and again, the matches are over within 1-2 minutes
    const arena = instances.find((i) => i.mode === 1) ?? instances[0];
    let t = NOW - 2 * DAY;
    for (let i = 0; i < 24; ++i) {
        const used = new Set([ROLES.winner.main.id, ROLES.loser.main.id]);
        const duration = int(45, 95);
        match(t, duration, arena, [ROLES.winner.main, ...team(1, used)], [ROLES.loser.main, ...team(1, used)], 1);
        t += duration + int(60, 240);
    }

    // scripter: very high apm, perfect input timing
    const scripter = ROLES.scripter.main;
    for (let i = 0; i < 18; ++i) {
        const instance = pick(instances);
        const size  = modes.get(instance.mode).size;
        const used  = new Set([scripter.id]);
        const start = NOW - int(1800, 2 * DAY);
        const duration = int(300, 900);
        const encounter = match(start, duration, instance, [scripter, ...team(size - 1, used)], team(size, used), chance(0.8) ? 1 : 2, {
            members: { [scripter.id]: { apm: between(360, 420), dps: between(3800, 4600) } },
        });

        if (i < 6) {
            skillInputs(scripter, start + 10, Math.min(240, duration - 20), 'script', encounter);
        }
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// support conversations
// ---------------------------------------------------------------------------------------------------------------------

db.transaction(() => {
    const admin = world.accounts.find((a) => a.name === 'admin') ?? world.accounts.find((a) => a.role === 2);
    const toxic = ROLES.toxic;

    ins.support({ account: toxic.id, character: toxic.main.id, moderator: admin?.id ?? null, direction: 0, time: NOW - 26 * 3600, read: 1,
        content: 'Hello ' + toxic.main.name + ', we received several reports about insults in the zone chat. Please keep the chat friendly, otherwise we have to mute your account.' });
    ins.support({ account: toxic.id, character: toxic.main.id, direction: 1, time: NOW - 25 * 3600, read: 1,
        content: 'they started it, the healer was afk the whole dungeon' });
    ins.support({ account: toxic.id, character: toxic.main.id, moderator: admin?.id ?? null, direction: 0, time: NOW - 25 * 3600 + 300, read: 1,
        content: 'Then please use the report function instead. This is the last warning.' });

    const asking = players[3];
    if (asking) {
        ins.support({ account: asking.id, character: asking.main.id, direction: 1, time: NOW - 40 * 60, read: 0,
            content: 'Hi, my quest item disappeared after a disconnect (Ironpeak Mines, the lantern). Can you help?' });
    }

    const victim = players[9];
    if (victim) {
        ins.support({ account: victim.id, character: victim.main.id, direction: 1, time: NOW - 3 * 3600, read: 0,
            content: 'Someone keeps spamming gold selling links in the trade chat, can you do something?' });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// quests (steps of the quests + progress of the characters)
// ---------------------------------------------------------------------------------------------------------------------

const QUEST_STEPS = {
    1: ["Talk to the widow in Highmere", "Search the old manor", "Defeat the grave robbers", "Return the tiara"],
    2: ["Ask the smith about the ring", "Collect ashes at the burned farm (10)", "Forge the ring at the anvil"],
    3: ["Follow the ghost lights", "Speak with the lost miner in Ironpeak Mines", "Recover the old lantern", "Light the path back"],
    4: ["Get an invitation", "Find a mask", "Identify the masked noble", "Unmask him at the ball"],
    5: ["Meet the troupe", "Collect stage props (5)", "Protect the actors during the play"],
    6: ["Investigate the well", "Collect water samples (3)", "Find the poisoner", "Bring the antidote to the healer"],
    7: ["Intercept the courier", "Read the letter", "Warn the captain"],
    8: ["Enter the orphanage", "Calm the children (6)", "Banish the shadows"],
    9: ["Talk to the mother", "Follow the tracks", "Defeat the kidnappers", "Bring the child home"],
    10: ["Bribe the guard", "Steal the keys", "Free the prisoners (4)", "Escape the city"],
    11: ["Inspect the crime scene", "Question the witnesses (3)", "Confront the murderer"],
    12: ["Recruit the crew (3)", "Get the vault plans", "Crack the vault", "Escape with the loot"],
    13: ["Ask around the village", "Search the forest", "Bring the puppy home"],
    14: ["Enter the trial grounds", "Survive three waves (3)", "Defeat the Ash Warden", "Claim the trial reward"],
};

db.transaction(() => {
    if (db.value('SELECT COUNT(*) FROM quest_state WHERE quest_state_quest IS NOT NULL') === 0) {
        for (const [quest, steps] of Object.entries(QUEST_STEPS)) {
            steps.forEach((title, i) => {
                const target = Number((/\((\d+)\)/.exec(title) ?? [0, 1])[1]);
                const state = Number(db.run('INSERT INTO quest_state (quest_state_quest, quest_state_order, quest_state_target) VALUES (?, ?, ?)', Number(quest), i + 1, target).lastInsertRowid);
                db.run('INSERT INTO quest_state_l11n (quest_state_l11n_title, quest_state_l11n_desc, quest_state_l11n_state) VALUES (?, NULL, ?)', title, state);
            });
        }
    }

    const states = db.all('SELECT quest_state_id AS id, quest_state_quest AS quest, quest_state_order AS position, quest_state_target AS target FROM quest_state WHERE quest_state_quest IS NOT NULL ORDER BY quest_state_quest, quest_state_order');
    const questIds = [...new Set(states.map((s) => s.quest))];

    const addQuest = (character, quest, doneSteps, started, completed) => {
        const list = states.filter((s) => s.quest === quest);
        const done = Math.min(doneSteps, list.length);
        const cq = Number(db.run(
            'INSERT INTO character_quest (character_quest_quest, character_quest_character, character_quest_status, character_quest_started, character_quest_completed) VALUES (?, ?, ?, ?, ?)',
            quest, character, done >= list.length ? 1 : 0, started, done >= list.length ? completed : null
        ).lastInsertRowid);

        list.forEach((step, i) => {
            if (i < done) {
                db.run('INSERT INTO character_quest_step (character_quest_step_quest, character_quest_step_state, character_quest_step_progress, character_quest_step_completed) VALUES (?, ?, ?, ?)', cq, step.id, step.target, started + Math.round((completed - started) * (i + 1) / list.length));
            } else if (i === done && chance(0.5)) {
                db.run('INSERT INTO character_quest_step (character_quest_step_quest, character_quest_step_state, character_quest_step_progress) VALUES (?, ?, ?)', cq, step.id, Math.floor(rnd() * step.target));
            }
        });
    };

    for (const c of world.characters) {
        const count = Math.min(questIds.length, Math.floor(c.level / 8) + int(0, 3));
        const chosen = [...questIds].sort(() => rnd() - 0.5).slice(0, count);
        for (const quest of chosen) {
            const started = NOW - int(2, 300) * DAY;
            const total = states.filter((s) => s.quest === quest).length;
            const finished = chance(0.7);
            addQuest(c.id, quest, finished ? total : int(0, total - 1), started, Math.min(NOW - 3600, started + int(1, 20) * 3600));
        }
    }

    // the player that asked the support about the lantern: stuck at "Recover the old lantern" (The Ghost Paths)
    const stuck = players[3]?.main;
    if (stuck) {
        db.run('DELETE FROM character_quest_step WHERE character_quest_step_quest IN (SELECT character_quest_id FROM character_quest WHERE character_quest_character = ? AND character_quest_quest = 3)', stuck.id);
        db.run('DELETE FROM character_quest WHERE character_quest_character = ? AND character_quest_quest = 3', stuck.id);
        addQuest(stuck.id, 3, 2, NOW - 2 * DAY, NOW - 3600);
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// inventories (backpacks, account stashes, guild vaults) with unique item ids
// ---------------------------------------------------------------------------------------------------------------------

const itemStats = { instances: 0, dupes: 0 };

const equipmentPiece = (character, level, rarity, time, name = null) => {
    const type = pick(world.equipment);
    const id = ins.individual({
        type: type.id, name: name ?? pick(['Worn', 'Sturdy', 'Fine', 'Ironbound', 'Frostforged', 'Runed', 'Ancient']) + ' ' + type.name,
        rarity, level, character, created: sqlDate(time),
    });
    remember('item_individual', id);

    return id;
};

const randomRarity = () => {
    const roll = rnd();

    return roll < 0.5 ? 1 : (roll < 0.78 ? 2 : (roll < 0.92 ? 3 : (roll < 0.97 ? 4 : (roll < 0.99 ? 5 : 6))));
};

const giveRandom = (ownerType, owner, character, level, count, equipmentChance) => {
    for (let i = 0; i < count; ++i) {
        const time = NOW - int(15, 200) * DAY - int(0, DAY);
        const origin = pick(['loot', 'loot', 'loot', 'quest', 'craft', 'vendor', 'trade']);

        if (chance(equipmentChance)) {
            const individual = equipmentPiece(character, Math.max(1, level + int(-5, 2)), randomRarity(), time);
            items.createInstance(db, { individual, quantity: 1, ownerType, owner, origin, time, character });
        } else {
            items.createInstance(db, { item: pick(world.items).id, quantity: chance(0.6) ? int(1, 20) : 1, ownerType, owner, origin, time, character });
        }

        ++itemStats.instances;
    }
};

db.transaction(() => {
    for (const c of world.characters.filter((x) => !x.dead)) {
        giveRandom('character', c.id, c.id, c.level, int(6, 16), 0.2);
    }

    for (const account of world.accounts) {
        giveRandom('account', account.id, null, account.main.level, int(3, 12), 0.25);
    }

    for (const guild of db.all('SELECT guild_id AS id FROM guild')) {
        giveRandom('guild', guild.id, null, 40, int(8, 25), 0.15);
    }

    // duplication: a raid item is traded to a partner, after a disconnect both have it (same uid)
    const duper = ROLES.duper.main;
    const partner = ROLES.duperPartner.main;
    const raidItems = ['Ashen Crown of the Fallen', 'Warden\'s Blade of Embers'];

    raidItems.forEach((name, i) => {
        const looted = NOW - (3 - i) * DAY - int(0, 3600);
        const individual = equipmentPiece(duper.id, Math.max(1, duper.level), 6, looted, name);
        const original = items.createInstance(db, { individual, ownerType: 'character', owner: duper.id, origin: 'loot', originRef: 'raid', time: looted, character: duper.id });

        const traded = looted + int(3600, 20 * 3600);
        const trade = ins.trade({ character1: duper.id, character2: partner.id, gold1: 0, gold2: 0, state: 1, created: traded - 40, updated: traded, server: duper.server, zone: world.zones[0].id });
        db.run('INSERT INTO trade_transaction_item (trade_transaction_item_trade, trade_transaction_item_side, trade_transaction_item_individual, trade_transaction_item_quantity, trade_transaction_item_uid) VALUES (?, 1, ?, 1, ?)', trade, individual, original.uid);
        items.logItem(db, { time: traded, sign: -1, character: duper.id, individual, quantity: 1, source: 'trade', uid: original.uid, player: partner.id });
        items.createInstance(db, { uid: original.uid, individual, ownerType: 'character', owner: partner.id, origin: 'trade', originRef: 'trade:' + trade, time: traded, character: partner.id });
        itemStats.dupes++;
    });

    // a stack that grew: 20 gold ingots were added, the stack has 250
    const ingot = world.items.find((it) => it.name === 'Gold Ingot') ?? world.items[0];
    const stack = items.createInstance(db, { item: ingot.id, quantity: 20, ownerType: 'character', owner: duper.id, origin: 'craft', time: NOW - 2 * DAY, character: duper.id });
    db.run('UPDATE item_instance SET item_instance_quantity = 250 WHERE item_instance_id = ?', stack.id);

    // items without any record of how they were obtained
    for (let i = 0; i < 4; ++i) {
        const individual = equipmentPiece(duper.id, duper.level, pick([5, 6]), NOW - DAY);
        items.createInstance(db, { individual, ownerType: 'account', owner: ROLES.duper.id, origin: 'loot', time: NOW - DAY + i * 600, log: false });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// instances that are running right now (online players in a dungeon, a raid and a PvP match)
// ---------------------------------------------------------------------------------------------------------------------

db.transaction(() => {
    const online = [...new Set(onlineCharacters)].map((id) => world.characters.find((c) => c.id === id))
        .filter((c) => c && !ROLES.bot.some((b) => b.main.id === c.id));
    const pickOnline = (count, used) => online.filter((c) => !used.has(c.id)).sort(() => rnd() - 0.5).slice(0, count).map((c) => {
        used.add(c.id);

        return c;
    });

    const used = new Set();
    const running = [
        { type: 'dungeon', size: 5, minutes: int(8, 15), duration: int(20, 35) * 60, difficulty: 'Normal' },
        { type: 'raid', size: 10, minutes: int(25, 50), duration: int(120, 160) * 60, difficulty: 'Heroic' },
        { type: 'pvp', size: 6, minutes: int(2, 6), duration: int(10, 14) * 60, difficulty: null },
    ];

    for (const r of running) {
        const instance = db.get(
            r.type === 'pvp'
                ? "SELECT i.instance_id AS id, p.pvp_mode_name AS mode, p.pvp_mode_size AS size FROM instance i JOIN pvp_mode p ON p.pvp_mode_id = i.instance_pvp_mode WHERE i.instance_type = 'pvp' AND p.pvp_mode_size = 3 LIMIT 1"
                : 'SELECT instance_id AS id, NULL AS mode, instance_size AS size FROM instance WHERE instance_type = ? ORDER BY instance_id LIMIT 1',
            ...(r.type === 'pvp' ? [] : [r.type])
        );
        const members = pickOnline(r.size, used);
        if (instance === null || members.length < 2) {
            continue;
        }

        const start = NOW - r.minutes * 60;
        // the game keeps the duration up to date, here the planned end is in the future = still running
        const encounter = Number(db.run(
            `INSERT INTO encounter (encounter_type, encounter_instance, encounter_difficulty, encounter_start, encounter_duration, encounter_success,
                encounter_winner, encounter_score1, encounter_score2) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
            r.type, instance.id, r.type === 'pvp' ? instance.mode : r.difficulty, sqlDate(start), r.duration,
            r.type === 'pvp' ? int(0, 2) : null, r.type === 'pvp' ? int(0, 2) : null
        ).lastInsertRowid);
        remember('encounter', encounter);

        members.forEach((c, i) => {
            const elapsed = r.minutes * 60;
            db.run(
                `INSERT INTO encounter_member (encounter_member_encounter, encounter_member_character, encounter_member_team, encounter_member_role,
                    encounter_member_damage, encounter_member_healing, encounter_member_deaths, encounter_member_kills, encounter_member_assists,
                    encounter_member_apm, encounter_member_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                encounter, c.id, r.type === 'pvp' ? (i % 2) + 1 : 1, i === 0 ? 'Tank' : (i === 1 ? 'Healer' : 'DPS'),
                Math.round(between(900, 3500) * elapsed), Math.round(between(50, 2000) * elapsed), int(0, 3), int(0, 5), int(0, 8),
                Math.round(between(40, 160) * 10) / 10, int(70, 99)
            );
        });

        if (r.type !== 'pvp') {
            const bosses = db.all('SELECT instance_boss_id AS id FROM instance_boss WHERE instance_boss_instance = ? ORDER BY instance_boss_order', instance.id);
            bosses.forEach((b, i) => {
                const killed = i === 0 ? 1 : 0;
                const id = Number(db.run('INSERT INTO encounter_boss (encounter_boss_encounter, encounter_boss_boss, encounter_boss_killed) VALUES (?, ?, ?)', encounter, b.id, killed).lastInsertRowid);
                if (i <= 1) {
                    db.run('INSERT INTO encounter_attempt (encounter_attempt_boss, encounter_attempt_no, encounter_attempt_duration, encounter_attempt_hp_left, encounter_attempt_kill) VALUES (?, 1, ?, ?, ?)', id, int(120, 300), killed ? 0 : int(20, 70), killed);
                }
            });
        }
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// what happened inside dungeons, raids, world boss fights and PvP matches (chat, loot, gold)
// ---------------------------------------------------------------------------------------------------------------------

const encounterStats = { encounters: 0, chat: 0, loot: 0 };

db.transaction(() => {
    const CHANNEL_FOR = { dungeon: CHANNEL.PARTY, raid: CHANNEL.RAID, pvp: CHANNEL.BATTLEGROUND, worldboss: CHANNEL.ZONE };
    const encounters = db.all(
        `SELECT encounter_id AS id, encounter_type AS type, encounter_start AS start, encounter_duration AS duration, encounter_winner AS winner
         FROM encounter WHERE encounter_start >= ? ORDER BY encounter_start`,
        sqlDate(NOW - 30 * DAY)
    );

    const byId = new Map(world.characters.map((c) => [c.id, c]));

    for (const e of encounters) {
        const start = Math.floor(Date.parse(e.start.replace(' ', 'T') + 'Z') / 1000);
        const duration = Math.max(60, e.duration ?? 600);
        if (start > NOW) {
            continue;
        }

        const members = db.all('SELECT encounter_member_character AS id, encounter_member_team AS team FROM encounter_member WHERE encounter_member_encounter = ?', e.id)
            .map((m) => ({ ...byId.get(m.id), team: m.team })).filter((m) => m.id !== undefined);
        if (members.length === 0) {
            continue;
        }

        ++encounterStats.encounters;
        const channel = CHANNEL_FOR[e.type] ?? CHANNEL.PARTY;

        // chat of the group (in PvP every team has its own chat)
        const messages = Math.min(25, Math.max(2, Math.round(duration / 150 * between(0.6, 1.4))));
        for (let i = 0; i < messages; ++i) {
            const member = pick(members);
            const time = Math.min(NOW - 1, start + int(0, duration));
            const losing = e.type === 'pvp' && e.winner !== null && member.team !== e.winner;
            const text = losing && chance(0.08) ? fake.toxicText(world, rnd) : pick(fake.PHRASES[channel] ?? fake.PHRASES[CHANNEL.PARTY]);
            ins.chat({ type: channel, time, content: text, character: member.id, server: member.server, encounter: e.id });
            ++encounterStats.chat;
        }

        if (e.type === 'pvp') {
            continue;
        }

        // loot of the bosses + gold for everybody
        const bosses = db.all('SELECT encounter_boss_id AS id, encounter_boss_killed AS killed, ib.instance_boss_name AS name FROM encounter_boss eb LEFT JOIN instance_boss ib ON ib.instance_boss_id = eb.encounter_boss_boss WHERE encounter_boss_encounter = ? ORDER BY encounter_boss_id', e.id);
        bosses.forEach((boss, index) => {
            if (!boss.killed) {
                return;
            }

            const time = Math.min(NOW - 1, start + Math.round(duration * (index + 1) / (bosses.length + 1)));
            for (let i = 0, n = e.type === 'raid' ? int(2, 4) : int(1, 2); i < n; ++i) {
                const winner = pick(members);
                const rarity = e.type === 'raid' ? int(4, 6) : int(2, 4);
                const individual = equipmentPiece(winner.id, Math.max(1, winner.level ?? 60), rarity, time,
                    pick(['Ashen', 'Runed', 'Frostforged', 'Ancient', 'Warden\'s']) + ' ' + pick(world.equipment).name + (boss.name ? ' of ' + boss.name : ''));
                items.createInstance(db, {
                    individual, ownerType: 'character', owner: winner.id, origin: 'loot', originRef: 'boss:' + boss.id, time, character: winner.id,
                    server: winner.server, logExtra: { encounter: e.id, rarity },
                });
                ++encounterStats.loot;
            }

            for (const member of members) {
                ins.gold({ time, character: member.id, server: member.server, sign: 1, source: 'loot', amount: int(40, e.type === 'raid' ? 450 : 180), encounter: e.id });
            }
        });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// player reports
// ---------------------------------------------------------------------------------------------------------------------

const reportStats = { reports: 0 };

db.transaction(() => {
    const moderators = world.accounts.filter((a) => a.role > 0).map((a) => a.id);
    const normal = players.filter((a) => !suspicious.has(a.id) && a.id !== ROLES.harassed?.id);
    const offenders = [...ROLES.bot, ROLES.toxic, ROLES.seller, ROLES.winner, ROLES.scripter, ROLES.duper].filter(Boolean);
    const CATEGORY_FOR = new Map([
        ...ROLES.bot.map((a) => [a.id, 'botting']), [ROLES.toxic.id, 'chat'], [ROLES.seller.id, 'scam'], [ROLES.winner.id, 'cheating'],
        [ROLES.scripter.id, 'cheating'], [ROLES.duper.id, 'exploit'],
    ]);
    const TEXTS = {
        botting: ['Runs the same circle in the mines all day, does not answer', 'Bot farming ore, 3 characters with the same pattern'],
        chat: ['Insults everyone in zone chat', 'Keeps calling people names after the dungeon'],
        scam: ['Spams gold selling websites', 'Tried to sell me gold for real money'],
        cheating: ['Wins every arena match in a few seconds, always against the same guy', 'Reacts faster than humanly possible'],
        exploit: ['Has two of the same raid item, I think it is a dupe', 'Sells many crowns of the fallen, nobody else has one'],
        harassment: ['Follows me around and kills my character', 'Keeps whispering me insults'],
        name: ['Offensive character name'],
        other: ['Stole my kill', 'Blocked the quest npc', 'Was rude in the group'],
    };

    const { badWords } = require('../src/detect');
    const toxicMessages = db.all('SELECT m.chat_message_id AS id, m.chat_message_content AS text, c.character_account AS account FROM chat_message m JOIN character c ON c.character_id = m.chat_message_character')
        .filter((m) => badWords(db, m.text).length > 0);

    const report = (reporter, target, category, created, status, text = null) => {
        const handled = status === 'open' ? null : created + int(600, 2 * DAY);
        const chatMessage = category === 'chat' ? (toxicMessages.find((m) => m.account === target.id)?.id ?? null) : null;
        db.run(
            `INSERT INTO player_report (player_report_reporter, player_report_reporter_character, player_report_account, player_report_character,
                player_report_category, player_report_text, player_report_chat_message, player_report_zone, player_report_server, player_report_created,
                player_report_status, player_report_moderator, player_report_handled, player_report_note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            reporter.id, reporter.main.id, target.id, target.main.id, category, text ?? pick(TEXTS[category] ?? TEXTS.other),
            chatMessage, pick(world.zones).id, target.main.server, created, status, status === 'open' ? null : pick(moderators), status === 'open' ? null : Math.min(NOW - 60, handled),
            status === 'rejected' ? pick(['No violation found', 'Normal gameplay', 'Not enough evidence']) : (status === 'action' ? pick(['Warned', 'Muted 1 day', 'Banned']) : null)
        );
        ++reportStats.reports;
    };

    // reports against the suspicious players (mostly right)
    for (const target of offenders) {
        for (let i = 0, n = int(3, 8); i < n; ++i) {
            const created = NOW - int(600, 6 * DAY);
            const old = created < NOW - 2 * DAY;
            report(pick(normal), target, CATEGORY_FOR.get(target.id) ?? 'other', created, old && chance(0.6) ? 'action' : 'open');
        }
    }

    // everyday reports: often unfounded
    for (let i = 0; i < 160; ++i) {
        const reporter = pick(normal);
        const target = pick(normal);
        if (reporter.id === target.id) {
            continue;
        }

        const created = NOW - int(600, 30 * DAY);
        const roll = rnd();
        const status = created > NOW - DAY && chance(0.7) ? 'open' : (roll < 0.35 ? 'action' : (roll < 0.9 ? 'rejected' : 'duplicate'));
        report(reporter, target, pick(['chat', 'harassment', 'name', 'other', 'other', 'cheating']), created, status);
    }

    // false reporter: reports again and again, almost always unfounded, mostly against the same player
    const falseReporter = ROLES.falseReporter;
    const harassed = ROLES.harassed;
    if (falseReporter && harassed) {
        for (let i = 0; i < 24; ++i) {
            const target = i % 3 === 0 ? pick(normal) : harassed;
            const created = NOW - int(2 * DAY, 30 * DAY);
            report(falseReporter, target, pick(['cheating', 'harassment', 'chat']), created, i === 5 || i === 17 ? 'action' : 'rejected');
        }

        for (let i = 0; i < 7; ++i) {
            report(falseReporter, harassed, pick(['cheating', 'harassment']), NOW - int(600, 6 * DAY), 'open', 'He is cheating again!!! ban him');
        }
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// ids in time order: the game writes the logs in the order things happen, the dummy data was created per player
// ---------------------------------------------------------------------------------------------------------------------

function renumber (table, id, time, references = [])
{
    db.exec('DROP TABLE IF EXISTS temp.id_map');
    db.exec(`CREATE TEMP TABLE id_map AS SELECT ${id} AS old, ROW_NUMBER() OVER (ORDER BY ${time}, ${id}) AS new FROM "${table}"`);
    db.exec('CREATE INDEX temp.id_map_old ON id_map (old)');
    db.exec(`UPDATE "${table}" SET ${id} = -${id}`);
    db.exec(`UPDATE "${table}" SET ${id} = (SELECT new FROM temp.id_map WHERE old = -${id})`);

    for (const [refTable, refColumn, condition] of references) {
        db.exec(`UPDATE "${refTable}" SET ${refColumn} = (SELECT new FROM temp.id_map WHERE old = CAST(${refColumn} AS INTEGER)) WHERE ${refColumn} IS NOT NULL` + (condition ? ' AND ' + condition : ''));
    }

    db.run('UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(' + id + '), 0) FROM "' + table + '") WHERE name = ?', table);
    db.exec('DROP TABLE temp.id_map');
}

db.transaction(() => {
    renumber('chat_message', 'chat_message_id', 'chat_message_time', [['player_report', 'player_report_chat_message'], ['log_message', 'log_message_ref']]);
    renumber('log_gold_transaction', 'log_gold_transaction_id', 'log_gold_transaction_time');
    renumber('log_item_transaction', 'log_item_transaction_id', 'log_item_transaction_time');

    // trades are also referenced in the origin of items ("trade:<id>")
    db.exec("UPDATE item_instance SET item_instance_origin_ref = CAST(SUBSTR(item_instance_origin_ref, 7) AS INTEGER) WHERE item_instance_origin = 'trade' AND item_instance_origin_ref LIKE 'trade:%'");
    renumber('trade_transaction', 'trade_transaction_id', 'trade_transaction_created', [
        ['trade_transaction_item', 'trade_transaction_item_trade'],
        ['item_instance', 'item_instance_origin_ref', "item_instance_origin = 'trade' AND item_instance_origin_ref GLOB '[0-9]*'"],
    ]);
    db.exec(`UPDATE item_instance SET item_instance_origin_ref = 'trade:' || item_instance_origin_ref WHERE item_instance_origin = 'trade' AND item_instance_origin_ref GLOB '[0-9]*'`);
});

db.exec('VACUUM');

console.log('Moderation dummy data (' + db.file + ')');
console.log(Object.entries(stats).map(([k, v]) => '  ' + k + ': ' + v).join('\n'));
console.log('  online characters: ' + onlineCharacters.length);
console.log('  item instances: ' + itemStats.instances + ' (+ ' + itemStats.dupes + ' duplicated raid items)');
console.log('  player reports: ' + reportStats.reports);
console.log('  encounters with chat/loot: ' + encounterStats.encounters + ' (' + encounterStats.chat + ' messages, ' + encounterStats.loot + ' boss drops)');
console.log('Suspicious accounts:');
for (const [role, value] of Object.entries(ROLES)) {
    const list = Array.isArray(value) ? value : [value];
    console.log('  ' + role.padEnd(14) + list.filter(Boolean).map((a) => a.name + ' (#' + a.id + ', ' + a.main.name + ')').join(', '));
}
