/**
 * Automatic detection of suspicious behavior
 *
 * Every rule returns findings, they are stored as flags (mod_flag). A flag is identified by rule + account + ref,
 * the ref of most rules is the day, so a dismissed flag stays dismissed for that day but the rule can flag again tomorrow.
 */
'use strict';

const { RULES, thresholds } = require('./rules');
const { now, sqlDate, median, meanStd } = require('./util');

const DAY = 86400;

/**
 * Bad words of the dictionary as one regular expression
 */
function badWordPattern (db, level)
{
    const words = db.all('SELECT bad_word_dictionary_word AS word FROM bad_word_dictionary WHERE COALESCE(bad_word_dictionary_level, 0) >= ?', level)
        .map((w) => String(w.word ?? '').trim().toLowerCase())
        .filter((w) => w.length > 1)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));

    if (words.length === 0) {
        return null;
    }

    words.sort((a, b) => b.length - a.length);

    return new RegExp('(?<![\\p{L}\\p{N}])(' + words.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
}

let patternCache = { key: '', pattern: null, time: 0 };

/**
 * Bad words in a text
 *
 * @param {import('./db').Database} db
 * @param {string} text
 * @param {number} level
 * @return {string[]}
 */
function badWords (db, text, level = 0)
{
    const key = String(level);
    if (patternCache.key !== key || Date.now() - patternCache.time > 30000) {
        patternCache = { key, pattern: badWordPattern(db, level), time: Date.now() };
    }

    if (patternCache.pattern === null || typeof text !== 'string') {
        return [];
    }

    return [...new Set([...text.matchAll(patternCache.pattern)].map((m) => m[1].toLowerCase()))];
}

function resetBadWordCache ()
{
    patternCache = { key: '', pattern: null, time: 0 };
}

/**
 * Main character of an account in the given rows (most entries)
 */
function mainOf (counts)
{
    let best = null;
    let max  = -1;
    for (const [character, count] of counts) {
        if (count > max) {
            best = character;
            max  = count;
        }
    }

    return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------------------------------------------------

const DETECTORS = {
    /** XP and gold per playtime */
    rates (db, th, t, day)
    {
        const since = t - th.window_hours * 3600;
        const minSeconds = th.min_playtime_minutes * 60;
        const accounts = new Map();

        const get = (account) => {
            if (!accounts.has(account)) {
                accounts.set(account, { seconds: 0, xp: 0, gold: 0, characters: new Map() });
            }

            return accounts.get(account);
        };

        for (const row of db.all(
            `SELECT c.character_account AS account, c.character_id AS character,
                    SUM(MIN(COALESCE(p.log_play_time_end, ?), ?) - MAX(p.log_play_time_start, ?)) AS seconds,
                    SUM(p.log_play_time_xp * 1.0 * (MIN(COALESCE(p.log_play_time_end, ?), ?) - MAX(p.log_play_time_start, ?))
                        / MAX(1, MIN(COALESCE(p.log_play_time_end, ?), ?) - p.log_play_time_start)) AS xp
             FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
             WHERE COALESCE(p.log_play_time_end, ?) > ?
             GROUP BY c.character_id`,
            t, t, since, t, t, since, t, t, t, since
        )) {
            const a = get(row.account);
            a.seconds += Math.max(0, row.seconds);
            a.xp += row.xp ?? 0;
            a.characters.set(row.character, (a.characters.get(row.character) ?? 0) + row.seconds);
        }

        for (const row of db.all(
            `SELECT c.character_account AS account, SUM(g.log_gold_transaction_amount) AS gold
             FROM log_gold_transaction g JOIN character c ON c.character_id = g.log_gold_transaction_character
             WHERE g.log_gold_transaction_time >= ? AND g.log_gold_transaction_sign = 1 AND g.log_gold_transaction_source IN ('loot', 'quest', 'vendor')
             GROUP BY c.character_account`,
            since
        )) {
            get(row.account).gold = row.gold ?? 0;
        }

        const findings = [];
        for (const [account, a] of accounts) {
            if (a.seconds < Math.max(60, minSeconds)) {
                continue;
            }

            const hours = a.seconds / 3600;
            const character = mainOf(a.characters);
            const xpPerHour = a.xp / hours;
            const goldPerMinute = a.gold / (a.seconds / 60);

            if (th['rule.xp_rate'] && xpPerHour > th.xp_per_hour) {
                findings.push({ rule: 'xp_rate', account, character, ref: day, value: xpPerHour, threshold: th.xp_per_hour,
                    detail: { xp: Math.round(a.xp), hours: Math.round(hours * 10) / 10, windowHours: th.window_hours } });
            }

            if (th['rule.gold_rate'] && goldPerMinute > th.gold_per_minute) {
                findings.push({ rule: 'gold_rate', account, character, ref: day, value: goldPerMinute, threshold: th.gold_per_minute,
                    detail: { gold: a.gold, hours: Math.round(hours * 10) / 10, windowHours: th.window_hours } });
            }
        }

        return findings;
    },

    /** Item drops per minute (busiest 10 minutes) */
    drops (db, th, t, day)
    {
        if (!th['rule.drop_rate']) {
            return [];
        }

        const since = t - th.window_hours * 3600;
        const best = new Map();

        for (const row of db.all(
            `SELECT c.character_account AS account, c.character_id AS character, i.log_item_transaction_time / 600 AS block, COUNT(*) AS drops,
                    MIN(i.log_item_transaction_area) AS zone
             FROM log_item_transaction i JOIN character c ON c.character_id = i.log_item_transaction_character
             WHERE i.log_item_transaction_time >= ? AND i.log_item_transaction_source = 'loot'
             GROUP BY c.character_id, block`,
            since
        )) {
            const current = best.get(row.account);
            if (current === undefined || row.drops > current.drops) {
                best.set(row.account, row);
            }
        }

        const findings = [];
        for (const [account, row] of best) {
            const perMinute = row.drops / 10;
            if (perMinute > th.items_per_minute) {
                findings.push({ rule: 'drop_rate', account, character: row.character, ref: day, value: perMinute, threshold: th.items_per_minute,
                    detail: { drops: row.drops, from: row.block * 600, to: row.block * 600 + 600, zone: row.zone } });
            }
        }

        return findings;
    },

    /** Average playtime per day over the last 5 days */
    playtime (db, th, t, day)
    {
        if (!th['rule.playtime']) {
            return [];
        }

        const since = t - 5 * DAY;
        const findings = [];

        for (const row of db.all(
            `SELECT c.character_account AS account, MAX(c.character_id) AS character,
                    SUM(MIN(COALESCE(p.log_play_time_end, ?), ?) - MAX(p.log_play_time_start, ?)) AS seconds,
                    COUNT(DISTINCT date(p.log_play_time_start, 'unixepoch')) AS days
             FROM log_play_time p JOIN character c ON c.character_id = p.log_play_time_character
             WHERE COALESCE(p.log_play_time_end, ?) > ?
             GROUP BY c.character_account`,
            t, t, since, t, since
        )) {
            const perDay = row.seconds / 5 / 3600;
            if (perDay > th.playtime_hours_per_day) {
                findings.push({ rule: 'playtime', account: row.account, character: row.character, ref: day, value: perDay,
                    threshold: th.playtime_hours_per_day, detail: { hours: Math.round(row.seconds / 360) / 10, days: row.days } });
            }
        }

        return findings;
    },

    /** Offensive messages and spam */
    chat (db, th, t, day)
    {
        const since = t - th.window_hours * 3600;
        const findings = [];
        const messages = db.all(
            `SELECT m.chat_message_id AS id, m.chat_message_time AS time, m.chat_message_content AS content, m.chat_message_character AS character,
                    c.character_account AS account
             FROM chat_message m JOIN character c ON c.character_id = m.chat_message_character
             WHERE m.chat_message_time >= ?
             ORDER BY m.chat_message_time`,
            since
        );

        // offensive
        if (th['rule.chat_toxic']) {
            const toxic = new Map();
            const known = new Set(db.all('SELECT log_message_ref AS ref FROM log_message WHERE log_message_ref IN (SELECT chat_message_id FROM chat_message WHERE chat_message_time >= ?)', since).map((r) => r.ref));

            for (const m of messages) {
                const words = badWords(db, m.content, th.chat_bad_word_level);
                if (words.length === 0) {
                    continue;
                }

                if (!known.has(m.id)) {
                    db.run('INSERT INTO log_message (log_message_ref, log_message_warning_level_automated, log_message_review_action) VALUES (?, ?, 0)', m.id, words.length);
                }

                if (!toxic.has(m.account)) {
                    toxic.set(m.account, { messages: [], characters: new Map() });
                }

                const entry = toxic.get(m.account);
                entry.messages.push({ id: m.id, time: m.time, text: m.content, words });
                entry.characters.set(m.character, (entry.characters.get(m.character) ?? 0) + 1);
            }

            for (const [account, entry] of toxic) {
                if (entry.messages.length >= th.chat_bad_words_per_day) {
                    findings.push({ rule: 'chat_toxic', account, character: mainOf(entry.characters), ref: day, value: entry.messages.length,
                        threshold: th.chat_bad_words_per_day, detail: { messages: entry.messages.slice(-10) } });
                }
            }
        }

        // spam: the same text again and again
        if (th['rule.chat_spam']) {
            const groups = new Map();
            for (const m of messages) {
                const key = m.character + '|' + String(m.content).toLowerCase().replace(/\s+/g, ' ').trim();
                if (!groups.has(key)) {
                    groups.set(key, { account: m.account, character: m.character, text: m.content, times: [] });
                }

                groups.get(key).times.push(m.time);
            }

            const window = th.chat_spam_window_minutes * 60;
            const best = new Map();
            for (const group of groups.values()) {
                let max = 0;
                for (let i = 0, j = 0; i < group.times.length; ++i) {
                    while (group.times[i] - group.times[j] > window) {
                        ++j;
                    }

                    max = Math.max(max, i - j + 1);
                }

                const current = best.get(group.account);
                if (max >= th.chat_spam_repeats && (current === undefined || max > current.max)) {
                    best.set(group.account, { ...group, max, total: group.times.length });
                }
            }

            for (const [account, group] of best) {
                findings.push({ rule: 'chat_spam', account, character: group.character, ref: day, value: group.max, threshold: th.chat_spam_repeats,
                    detail: { text: group.text, total: group.total, windowMinutes: th.chat_spam_window_minutes } });
            }
        }

        return findings;
    },

    /** The same route in several sessions */
    paths (db, th, t)
    {
        if (!th['rule.bot_path']) {
            return [];
        }

        const since = t - Math.max(th.window_hours, 48) * 3600;
        const grid  = Math.max(1, th.path_grid_size);
        const sessions = new Map();

        for (const p of db.all(
            `SELECT log_snapshot_session AS session, log_snapshot_character AS character, log_snapshot_area AS zone,
                    log_snapshot_location_x AS x, log_snapshot_location_y AS y
             FROM log_snapshot WHERE log_snapshot_time >= ? ORDER BY log_snapshot_session, log_snapshot_time`,
            since
        )) {
            let s = sessions.get(p.session);
            if (s === undefined) {
                s = { character: p.character, zone: p.zone, cells: [] };
                sessions.set(p.session, s);
            }

            const cell = Math.floor(p.x / grid) + ':' + Math.floor(p.y / grid);
            if (s.cells.at(-1) !== cell) {
                s.cells.push(cell);
            }
        }

        const byCharacter = new Map();
        for (const [id, s] of sessions) {
            if (s.cells.length < 20) {
                continue;
            }

            const transitions = new Set();
            for (let i = 1; i < s.cells.length; ++i) {
                transitions.add(s.zone + '|' + s.cells[i - 1] + '>' + s.cells[i]);
            }

            if (!byCharacter.has(s.character)) {
                byCharacter.set(s.character, []);
            }

            byCharacter.get(s.character).push({ id, transitions });
        }

        const findings = [];
        const accounts = new Map(db.all('SELECT character_id AS id, character_account AS account FROM character').map((c) => [c.id, c.account]));

        for (const [character, list] of byCharacter) {
            if (list.length < th.path_min_sessions) {
                continue;
            }

            const similar = new Set();
            let best = 0;
            let sum = 0;
            let pairs = 0;

            for (let i = 0; i < list.length; ++i) {
                for (let j = i + 1; j < list.length; ++j) {
                    let common = 0;
                    for (const tr of list[i].transitions) {
                        if (list[j].transitions.has(tr)) {
                            ++common;
                        }
                    }

                    const similarity = common / (list[i].transitions.size + list[j].transitions.size - common);
                    best = Math.max(best, similarity);
                    sum += similarity;
                    ++pairs;

                    if (similarity >= th.path_similarity) {
                        similar.add(list[i].id);
                        similar.add(list[j].id);
                    }
                }
            }

            if (similar.size >= th.path_min_sessions) {
                findings.push({ rule: 'bot_path', account: accounts.get(character), character, ref: 'character:' + character, value: best,
                    threshold: th.path_similarity, detail: { sessions: [...similar], checked: list.length, average: pairs > 0 ? sum / pairs : 0 } });
            }
        }

        return findings;
    },

    /** Skill input timing */
    inputs (db, th, t, day)
    {
        if (!th['rule.input_script']) {
            return [];
        }

        const since = (t - Math.max(th.window_hours, 48) * 3600) * 1000;
        const findings = [];
        const accounts = new Map(db.all('SELECT character_id AS id, character_account AS account FROM character').map((c) => [c.id, c.account]));

        let current = null;
        const evaluate = (c) => {
            if (c === null || c.intervals < 20) {
                return;
            }

            const fastRatio = c.fast / c.intervals;
            let worst = null;
            for (const [combo, list] of c.combos) {
                if (list.length < th.input_min_samples) {
                    continue;
                }

                const { mean, std } = meanStd(list);
                const cv = mean > 0 ? std / mean : 0;
                if (worst === null || cv < worst.cv) {
                    worst = { combo, cv, mean, samples: list.length };
                }
            }

            const regular = worst !== null && worst.cv < th.input_interval_cv;
            const fast = fastRatio > th.input_fast_ratio;
            if (regular || fast) {
                findings.push({
                    rule: 'input_script', account: accounts.get(c.character), character: c.character, ref: day,
                    value: regular ? worst.cv : fastRatio, threshold: regular ? th.input_interval_cv : th.input_fast_ratio,
                    detail: { reason: regular && fast ? 'regular+fast' : (regular ? 'regular' : 'fast'), fastRatio, combo: worst, inputs: c.intervals + 1 },
                });
            }
        };

        for (const row of db.all(
            `SELECT log_skill_input_character AS character, log_skill_input_skill AS skill, log_skill_input_time AS time
             FROM log_skill_input WHERE log_skill_input_time >= ? ORDER BY log_skill_input_character, log_skill_input_time`,
            since
        )) {
            if (current === null || current.character !== row.character) {
                evaluate(current);
                current = { character: row.character, last: null, intervals: 0, fast: 0, combos: new Map() };
            }

            if (current.last !== null) {
                const interval = row.time - current.last.time;
                if (interval <= 3000) {
                    ++current.intervals;
                    if (interval < th.input_min_interval_ms) {
                        ++current.fast;
                    }

                    const combo = current.last.skill + '>' + row.skill;
                    if (!current.combos.has(combo)) {
                        current.combos.set(combo, []);
                    }

                    current.combos.get(combo).push(interval);
                }
            }

            current.last = row;
        }

        evaluate(current);

        return findings;
    },

    /** APM, streaks and short matches (PvP, last 7 days) */
    pvp (db, th, t, day)
    {
        const since = sqlDate(t - 7 * DAY);
        const findings = [];
        const matches = db.all(
            `SELECT c.character_account AS account, c.character_id AS character, e.encounter_id AS id, e.encounter_start AS start,
                    e.encounter_duration AS duration, e.encounter_type AS type, (e.encounter_winner = m.encounter_member_team) AS won,
                    m.encounter_member_apm AS apm
             FROM encounter_member m
             JOIN encounter e ON e.encounter_id = m.encounter_member_encounter
             JOIN character c ON c.character_id = m.encounter_member_character
             WHERE e.encounter_start >= ?
             ORDER BY c.character_account, e.encounter_start`,
            since
        );

        const byAccount = new Map();
        for (const m of matches) {
            if (!byAccount.has(m.account)) {
                byAccount.set(m.account, []);
            }

            byAccount.get(m.account).push(m);
        }

        for (const [account, list] of byAccount) {
            if (th['rule.apm']) {
                const high = list.filter((m) => m.apm > th.apm_max);
                if (high.length > 0) {
                    const max = high.reduce((a, b) => (b.apm > a.apm ? b : a));
                    findings.push({ rule: 'apm', account, character: max.character, ref: day, value: max.apm, threshold: th.apm_max,
                        detail: { encounters: high.slice(-10).map((m) => m.id), count: high.length } });
                }
            }

            const pvp = list.filter((m) => m.type === 'pvp');

            if (th['rule.streak']) {
                let best = { length: 0 };
                let run  = { length: 0 };
                for (const m of pvp) {
                    if (run.length > 0 && run.won === m.won) {
                        run.length++;
                        run.to = m.id;
                    } else {
                        run = { length: 1, won: m.won, from: m.id, to: m.id, character: m.character };
                    }

                    if (run.length > best.length) {
                        best = { ...run };
                    }
                }

                if (best.length >= th.streak_length) {
                    findings.push({ rule: 'streak', account, character: best.character, ref: day, value: best.length, threshold: th.streak_length,
                        detail: { type: best.won ? 'wins' : 'losses', from: best.from, to: best.to } });
                }
            }

            if (th['rule.short_matches']) {
                const short = pvp.filter((m) => m.duration < th.short_match_seconds);
                if (short.length >= th.short_match_count) {
                    findings.push({ rule: 'short_matches', account, character: short.at(-1).character, ref: day, value: short.length,
                        threshold: th.short_match_count, detail: { matches: short.slice(-15).map((m) => ({ id: m.id, duration: m.duration, won: m.won })) } });
                }
            }
        }

        // partners: accounts that are often in the short matches together are listed in the detail of the flag
        return findings;
    },

    /** Auction prices far away from the median */
    auctions (db, th, t, day)
    {
        if (!th['rule.auction_price']) {
            return [];
        }

        const prices = new Map();
        for (const a of db.all(
            `SELECT auction_item AS item, auction_prize_min * 1.0 / MAX(1, auction_quantity) AS unit FROM auction WHERE auction_start >= ?`,
            t - 30 * DAY
        )) {
            if (!prices.has(a.item)) {
                prices.set(a.item, []);
            }

            prices.get(a.item).push(a.unit);
        }

        const medians = new Map();
        for (const [item, list] of prices) {
            if (list.length >= th.auction_min_samples) {
                medians.set(item, median(list));
            }
        }

        const grouped = new Map();
        const add = (account, character, entry) => {
            if (account === null || account === undefined) {
                return;
            }

            if (!grouped.has(account)) {
                grouped.set(account, { character, auctions: [], worst: 1 });
            }

            const g = grouped.get(account);
            g.auctions.push(entry);
            const distance = entry.factor >= 1 ? entry.factor : 1 / Math.max(entry.factor, 0.0001);
            g.worst = Math.max(g.worst, distance);
            g.factor = distance === g.worst ? entry.factor : g.factor;
        };

        for (const a of db.all(
            `SELECT a.auction_id AS id, a.auction_item AS item, a.auction_prize_min * 1.0 / MAX(1, a.auction_quantity) AS unit, a.auction_quantity AS quantity,
                    a.auction_character AS seller, cs.character_account AS sellerAccount, tx.auction_transaction_buyer AS buyer,
                    cb.character_account AS buyerAccount, a.auction_start AS start, tx.auction_transaction_datetime AS sold
             FROM auction a
             JOIN character cs ON cs.character_id = a.auction_character
             LEFT JOIN auction_transaction tx ON tx.auction_transaction_auction = a.auction_id
             LEFT JOIN character cb ON cb.character_id = tx.auction_transaction_buyer
             WHERE a.auction_start >= ?`,
            t - 7 * DAY
        )) {
            const med = medians.get(a.item);
            if (med === undefined || med <= 0) {
                continue;
            }

            const factor = a.unit / med;
            if (factor >= th.auction_price_low_factor && factor <= th.auction_price_high_factor) {
                continue;
            }

            const entry = { id: a.id, item: a.item, unit: Math.round(a.unit), median: Math.round(med), factor, quantity: a.quantity,
                seller: a.seller, buyer: a.buyer, soldAfter: a.sold ? a.sold - a.start : null };
            add(a.sellerAccount, a.seller, { ...entry, role: 'seller' });
            add(a.buyerAccount, a.buyer, { ...entry, role: 'buyer' });
        }

        return [...grouped].map(([account, g]) => ({
            rule: 'auction_price', account, character: g.character, ref: day, value: g.factor,
            threshold: g.factor < 1 ? th.auction_price_low_factor : th.auction_price_high_factor, detail: { auctions: g.auctions.slice(-10), count: g.auctions.length },
        }));
    },

    /** Gold for nothing */
    trades (db, th, t, day)
    {
        if (!th['rule.trade_gold']) {
            return [];
        }

        const grouped = new Map();
        for (const tr of db.all(
            `SELECT t.trade_transaction_id AS id, t.trade_transaction_character1 AS c1, t.trade_transaction_character2 AS c2,
                    t.trade_transaction_gold1 AS g1, t.trade_transaction_gold2 AS g2, a1.character_account AS a1, a2.character_account AS a2,
                    (SELECT COUNT(*) FROM trade_transaction_item i WHERE i.trade_transaction_item_trade = t.trade_transaction_id AND i.trade_transaction_item_side = 1) AS items1,
                    (SELECT COUNT(*) FROM trade_transaction_item i WHERE i.trade_transaction_item_trade = t.trade_transaction_id AND i.trade_transaction_item_side = 2) AS items2,
                    t.trade_transaction_updated AS time
             FROM trade_transaction t
             JOIN character a1 ON a1.character_id = t.trade_transaction_character1
             JOIN character a2 ON a2.character_id = t.trade_transaction_character2
             WHERE t.trade_transaction_state = 1 AND t.trade_transaction_updated >= ?
               AND (t.trade_transaction_gold1 >= ? OR t.trade_transaction_gold2 >= ?)`,
            t - 7 * DAY, th.trade_one_sided_gold, th.trade_one_sided_gold
        )) {
            for (const [giver, receiver, gold, back, backItems] of [
                [{ a: tr.a1, c: tr.c1 }, { a: tr.a2, c: tr.c2 }, tr.g1, tr.g2, tr.items2],
                [{ a: tr.a2, c: tr.c2 }, { a: tr.a1, c: tr.c1 }, tr.g2, tr.g1, tr.items1],
            ]) {
                if (gold < th.trade_one_sided_gold || back > 0 || backItems > 0) {
                    continue;
                }

                for (const [side, other, role] of [[giver, receiver, 'gave'], [receiver, giver, 'received']]) {
                    if (!grouped.has(side.a)) {
                        grouped.set(side.a, { character: side.c, trades: [], gold: 0 });
                    }

                    const g = grouped.get(side.a);
                    g.trades.push({ id: tr.id, role, gold, partner: other.c, time: tr.time });
                    g.gold += gold;
                }
            }
        }

        return [...grouped].map(([account, g]) => ({
            rule: 'trade_gold', account, character: g.character, ref: day, value: g.gold, threshold: th.trade_one_sided_gold,
            detail: { trades: g.trades.slice(-12), count: g.trades.length },
        }));
    },

    /** Duplicated items, items without origin, grown stacks */
    items (db, th, t)
    {
        const findings = [];

        // owner of an instance -> account (guild items: the founder of the guild)
        const accountOf = (type, owner) => {
            if (type === 'account') {
                return owner;
            }

            if (type === 'character') {
                return db.value('SELECT character_account FROM character WHERE character_id = ?', owner);
            }

            return db.value(
                `SELECT c.character_account FROM guild_member m JOIN character c ON c.character_id = m.guild_member_character
                 WHERE m.guild_member_guild = ? ORDER BY m.guild_member_role, m.guild_member_id LIMIT 1`,
                owner
            );
        };

        const name = `COALESCE(iv.item_individual_name, it.item_name, 'Unknown item')`;
        const base = `FROM item_instance ii LEFT JOIN item it ON it.item_id = ii.item_instance_item
                      LEFT JOIN item_individual iv ON iv.item_individual_id = ii.item_instance_individual`;

        if (th['rule.item_dupe']) {
            const dupes = db.all(
                `SELECT ii.item_instance_uid AS uid FROM item_instance ii WHERE ii.item_instance_deleted IS NULL
                 GROUP BY ii.item_instance_uid HAVING COUNT(*) > 1`
            );

            for (const { uid } of dupes) {
                const copies = db.all(
                    `SELECT ii.item_instance_id AS id, ii.item_instance_owner_type AS ownerType, ii.item_instance_owner AS owner,
                            ii.item_instance_container AS container, ii.item_instance_created AS created, ii.item_instance_quantity AS quantity, ` + name + ` AS name
                     ` + base + ` WHERE ii.item_instance_uid = ? AND ii.item_instance_deleted IS NULL ORDER BY ii.item_instance_created`,
                    uid
                );

                const accounts = new Map();
                for (const copy of copies) {
                    const account = accountOf(copy.ownerType, copy.owner);
                    if (account !== null && !accounts.has(account)) {
                        accounts.set(account, copy.ownerType === 'character' ? copy.owner : null);
                    }
                }

                for (const [account, character] of accounts) {
                    findings.push({ rule: 'item_dupe', account, character, ref: 'uid:' + uid, value: copies.length, threshold: 1,
                        detail: { uid, name: copies[0].name, copies } });
                }
            }
        }

        if (th['rule.item_origin']) {
            const grouped = new Map();
            for (const row of db.all(
                `SELECT ii.item_instance_id AS id, ii.item_instance_uid AS uid, ii.item_instance_owner_type AS ownerType, ii.item_instance_owner AS owner,
                        ii.item_instance_created AS created, ii.item_instance_quantity AS quantity, ` + name + ` AS name
                 ` + base + `
                 WHERE ii.item_instance_deleted IS NULL AND ii.item_instance_created < ?
                   AND NOT EXISTS (SELECT 1 FROM log_item_transaction l WHERE l.log_item_transaction_uid = ii.item_instance_uid AND l.log_item_transaction_sign = 1)`,
                t - th.item_origin_grace_minutes * 60
            )) {
                const account = accountOf(row.ownerType, row.owner);
                if (account === null) {
                    continue;
                }

                if (!grouped.has(account)) {
                    grouped.set(account, { character: row.ownerType === 'character' ? row.owner : null, items: [] });
                }

                grouped.get(account).items.push(row);
            }

            for (const [account, g] of grouped) {
                findings.push({ rule: 'item_origin', account, character: g.character, ref: 'items', value: g.items.length, threshold: 0,
                    detail: { items: g.items.slice(0, 12), count: g.items.length } });
            }
        }

        if (th['rule.item_quantity']) {
            for (const row of db.all(
                `SELECT ii.item_instance_id AS id, ii.item_instance_uid AS uid, ii.item_instance_owner_type AS ownerType, ii.item_instance_owner AS owner,
                        ii.item_instance_quantity AS quantity, ` + name + ` AS name, l.added AS added
                 ` + base + `
                 JOIN (SELECT log_item_transaction_uid AS uid,
                              SUM(CASE WHEN log_item_transaction_sign = 1 THEN log_item_transaction_quantity ELSE 0 END) AS added
                       FROM log_item_transaction WHERE log_item_transaction_uid IS NOT NULL GROUP BY log_item_transaction_uid) l ON l.uid = ii.item_instance_uid
                 WHERE ii.item_instance_deleted IS NULL AND ii.item_instance_quantity > l.added + ?`,
                th.item_quantity_tolerance
            )) {
                const account = accountOf(row.ownerType, row.owner);
                if (account !== null) {
                    findings.push({ rule: 'item_quantity', account, character: row.ownerType === 'character' ? row.owner : null, ref: 'uid:' + row.uid,
                        value: row.quantity, threshold: row.added, detail: { uid: row.uid, name: row.name, quantity: row.quantity, added: row.added, id: row.id } });
                }
            }
        }

        return findings;
    },

    /** Reporters with mostly unfounded reports, report spam */
    reports (db, th, t, day)
    {
        const findings = [];

        if (th['rule.false_reports']) {
            for (const row of db.all(
                `SELECT player_report_reporter AS account, player_report_reporter_character AS character,
                        SUM(player_report_status = 'action') AS actions, SUM(player_report_status = 'rejected') AS rejected, COUNT(*) AS total
                 FROM player_report GROUP BY player_report_reporter`
            )) {
                const handled = row.actions + row.rejected;
                const ratio = handled > 0 ? row.rejected / handled : 0;
                if (handled >= th.report_min_resolved && ratio >= th.report_false_ratio) {
                    findings.push({ rule: 'false_reports', account: row.account, character: row.character, ref: 'reports', value: ratio,
                        threshold: th.report_false_ratio, detail: { total: row.total, actions: row.actions, rejected: row.rejected } });
                }
            }
        }

        if (th['rule.report_spam']) {
            const perDay = new Map(db.all(
                'SELECT player_report_reporter AS account, COUNT(*) AS count FROM player_report WHERE player_report_created >= ? GROUP BY player_report_reporter',
                t - DAY
            ).map((r) => [r.account, r.count]));

            const sameTarget = new Map();
            for (const row of db.all(
                `SELECT r.player_report_reporter AS account, r.player_report_account AS target, a.account_name AS targetName, COUNT(*) AS count
                 FROM player_report r LEFT JOIN account a ON a.account_id = r.player_report_account
                 WHERE r.player_report_created >= ? GROUP BY r.player_report_reporter, r.player_report_account HAVING count >= ?`,
                t - 7 * DAY, th.report_same_target
            )) {
                const current = sameTarget.get(row.account);
                if (current === undefined || row.count > current.count) {
                    sameTarget.set(row.account, row);
                }
            }

            for (const account of new Set([...perDay.keys(), ...sameTarget.keys()])) {
                const day24 = perDay.get(account) ?? 0;
                const target = sameTarget.get(account) ?? null;
                if (day24 < th.report_max_per_day && target === null) {
                    continue;
                }

                findings.push({ rule: 'report_spam', account, character: null, ref: day, value: Math.max(day24, target?.count ?? 0),
                    threshold: target !== null ? th.report_same_target : th.report_max_per_day, detail: { day: day24, target } });
            }
        }

        return findings;
    },

    /** Several accounts on the same hardware */
    hardware (db, th, t)
    {
        if (!th['rule.shared_hardware']) {
            return [];
        }

        const findings = [];
        for (const row of db.all(
            `SELECT log_auth_hardware AS hardware, GROUP_CONCAT(DISTINCT log_auth_account) AS accounts, COUNT(DISTINCT log_auth_account) AS count
             FROM log_auth WHERE log_auth_time >= ? AND log_auth_hardware IS NOT NULL
             GROUP BY log_auth_hardware HAVING count >= ?`,
            t - 30 * DAY, th.shared_hardware_accounts
        )) {
            const accounts = String(row.accounts).split(',').map(Number);
            for (const account of accounts) {
                findings.push({ rule: 'shared_hardware', account, character: null, ref: 'hw:' + row.hardware, value: row.count,
                    threshold: th.shared_hardware_accounts, detail: { hardware: row.hardware, accounts } });
            }
        }

        return findings;
    },
};

/**
 * Run all rules and store the flags
 *
 * @param {import('./db').Database} db
 *
 * @return {{created:number[], updated:number, findings:number, ms:number}}
 */
function detect (db)
{
    const started = Date.now();
    const th  = thresholds(db);
    const t   = now();
    const day = sqlDate(t).slice(0, 10);

    const findings = [];
    for (const [name, fn] of Object.entries(DETECTORS)) {
        try {
            findings.push(...fn(db, th, t, day));
        } catch (error) {
            console.error('Detection "' + name + '" failed:', error);
        }
    }

    const created = [];
    let updated = 0;

    db.transaction(() => {
        for (const f of findings) {
            if (f.account === null || f.account === undefined) {
                continue;
            }

            const existing = db.get('SELECT mod_flag_id AS id FROM mod_flag WHERE mod_flag_rule = ? AND mod_flag_account = ? AND mod_flag_ref = ?', f.rule, f.account, f.ref);
            const detail = JSON.stringify(f.detail ?? {});
            const severity = RULES[f.rule]?.severity ?? 1;

            if (existing === null) {
                const result = db.run(
                    `INSERT INTO mod_flag (mod_flag_rule, mod_flag_account, mod_flag_character, mod_flag_ref, mod_flag_severity, mod_flag_value,
                        mod_flag_threshold, mod_flag_detail, mod_flag_first_seen, mod_flag_last_seen, mod_flag_hits, mod_flag_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'open')`,
                    f.rule, f.account, f.character ?? null, f.ref, severity, f.value, f.threshold, detail, t, t
                );
                created.push(Number(result.lastInsertRowid));
            } else {
                db.run(
                    `UPDATE mod_flag SET mod_flag_value = ?, mod_flag_threshold = ?, mod_flag_detail = ?, mod_flag_last_seen = ?,
                        mod_flag_hits = mod_flag_hits + 1, mod_flag_character = COALESCE(?, mod_flag_character) WHERE mod_flag_id = ?`,
                    f.value, f.threshold, detail, t, f.character ?? null, existing.id
                );
                ++updated;
            }
        }
    });

    return { created, updated, findings: findings.length, ms: Date.now() - started };
}

module.exports = { detect, badWords, resetBadWordCache, DETECTORS };
