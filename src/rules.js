/**
 * Thresholds and detection rules
 *
 * The values are stored in mod_threshold (config page), the defaults/descriptions live here.
 */
'use strict';

/**
 * @typedef {{key:string, label:string, unit:string, value:number, min?:number, max?:number, step?:number, help:string}} Threshold
 */

/** @type {Array<{group:string, items:Threshold[]}>} */
const THRESHOLDS = [
    {
        group: 'General',
        items: [
            { key: 'window_hours', label: 'Analysis window', unit: 'hours', value: 24, min: 1, max: 720, step: 1, help: 'Rate based rules (xp, gold, drops, chat) look at this time span.' },
            { key: 'min_playtime_minutes', label: 'Minimum playtime', unit: 'minutes', value: 30, min: 0, max: 1440, step: 1, help: 'Rate based rules are only checked for accounts with at least this much playtime in the window (avoids false alarms for very short sessions).' },
            { key: 'detection_interval_seconds', label: 'Detection interval', unit: 'seconds', value: 60, min: 10, max: 3600, step: 1, help: 'How often the server checks the rules automatically.' },
        ],
    },
    {
        group: 'Progress & economy',
        items: [
            { key: 'xp_per_hour', label: 'XP per hour', unit: 'xp/h', value: 90000, min: 0, step: 1000, help: 'XP earned per hour of playtime (whole account).' },
            { key: 'gold_per_minute', label: 'Gold per minute', unit: 'gold/min', value: 120, min: 0, step: 1, help: 'Gold income from loot, quests and vendors per minute of playtime. Trades and auctions are not counted.' },
            { key: 'items_per_minute', label: 'Item drops per minute', unit: 'items/min', value: 4, min: 0, step: 0.1, help: 'Highest number of item drops per minute within any 10 minute block.' },
            { key: 'playtime_hours_per_day', label: 'Playtime per day', unit: 'hours/day', value: 16, min: 1, max: 24, step: 0.5, help: 'Average playtime per day over the last 5 days. Bots often play around the clock.' },
            { key: 'auction_price_low_factor', label: 'Auction price: too low', unit: 'x median', value: 0.2, min: 0, max: 1, step: 0.01, help: 'Auction price per unit below this factor of the median price of the item.' },
            { key: 'auction_price_high_factor', label: 'Auction price: too high', unit: 'x median', value: 5, min: 1, step: 0.1, help: 'Auction price per unit above this factor of the median price of the item (gold transfer via overpriced items).' },
            { key: 'auction_min_samples', label: 'Auction: minimum samples', unit: 'auctions', value: 5, min: 2, step: 1, help: 'Number of auctions of an item needed before a median is used.' },
            { key: 'trade_one_sided_gold', label: 'One-sided trade', unit: 'gold', value: 50000, min: 0, step: 100, help: 'Completed trade where one side gives at least this much gold and receives nothing (real money trading, gold selling).' },
        ],
    },
    {
        group: 'Chat',
        items: [
            { key: 'chat_bad_word_level', label: 'Bad word level', unit: 'level', value: 0, min: 0, max: 1, step: 1, help: 'Only words of the bad word dictionary with at least this level are counted (0 = all words, 1 = only severe words).' },
            { key: 'chat_bad_words_per_day', label: 'Offensive messages', unit: 'messages', value: 3, min: 1, step: 1, help: 'Messages with bad words within the analysis window.' },
            { key: 'chat_spam_repeats', label: 'Spam: repeated messages', unit: 'messages', value: 5, min: 2, step: 1, help: 'The same message sent this often within the spam window.' },
            { key: 'chat_spam_window_minutes', label: 'Spam window', unit: 'minutes', value: 10, min: 1, step: 1, help: 'Time span for the spam rule.' },
        ],
    },
    {
        group: 'Bots & scripts',
        items: [
            { key: 'path_grid_size', label: 'Path grid size', unit: 'units', value: 10, min: 1, step: 1, help: 'Positions are snapped to a grid of this size before routes are compared.' },
            { key: 'path_similarity', label: 'Path similarity', unit: '0-1', value: 0.75, min: 0, max: 1, step: 0.01, help: 'Two play sessions of a character follow (nearly) the same route if the share of identical grid transitions is above this value.' },
            { key: 'path_min_sessions', label: 'Repeated routes', unit: 'sessions', value: 3, min: 2, step: 1, help: 'Number of sessions with the same route before a character is flagged.' },
            { key: 'input_min_interval_ms', label: 'Inhuman input interval', unit: 'ms', value: 60, min: 1, step: 1, help: 'Skill presses faster than this after the previous press.' },
            { key: 'input_fast_ratio', label: 'Share of inhuman inputs', unit: '0-1', value: 0.05, min: 0, max: 1, step: 0.01, help: 'Share of presses below the inhuman interval.' },
            { key: 'input_interval_cv', label: 'Combo timing variation', unit: 'CV', value: 0.08, min: 0, max: 1, step: 0.01, help: 'Coefficient of variation (std. deviation / mean) of the time between two skills that are often used together. Humans are irregular, scripts are not.' },
            { key: 'input_min_samples', label: 'Combo minimum samples', unit: 'combos', value: 30, min: 5, step: 1, help: 'A skill combination must be used this often before its timing is evaluated.' },
            { key: 'apm_max', label: 'Actions per minute', unit: 'apm', value: 300, min: 0, step: 1, help: 'Average actions per minute in an encounter.' },
        ],
    },
    {
        group: 'PvP',
        items: [
            { key: 'streak_length', label: 'Win/loss streak', unit: 'matches', value: 15, min: 2, step: 1, help: 'Matches in a row won (or lost) within the last 7 days.' },
            { key: 'short_match_seconds', label: 'Short match', unit: 'seconds', value: 120, min: 1, step: 1, help: 'Matches shorter than this are counted as suspiciously short (win trading, leaving).' },
            { key: 'short_match_count', label: 'Short matches', unit: 'matches', value: 5, min: 1, step: 1, help: 'Number of short matches within the last 7 days.' },
        ],
    },
    {
        group: 'Items',
        items: [
            { key: 'item_origin_grace_minutes', label: 'Item origin grace time', unit: 'minutes', value: 10, min: 0, step: 1, help: 'Items without a log entry of how they were obtained are only flagged when they are older than this (the game may write the log a bit later).' },
            { key: 'item_quantity_tolerance', label: 'Stack tolerance', unit: 'items', value: 0, min: 0, step: 1, help: 'A stack may contain this many items more than were ever added to it before it is flagged.' },
        ],
    },
    {
        group: 'Player reports',
        items: [
            { key: 'report_min_resolved', label: 'Minimum handled reports', unit: 'reports', value: 8, min: 1, step: 1, help: 'A reporter is only rated after this many of his reports were handled by the team.' },
            { key: 'report_false_ratio', label: 'False report ratio', unit: '0-1', value: 0.75, min: 0, max: 1, step: 0.01, help: 'Share of handled reports without violation (rejected) from which a reporter is flagged.' },
            { key: 'report_max_per_day', label: 'Reports per day', unit: 'reports', value: 10, min: 1, step: 1, help: 'Reports filed by one account within 24 hours.' },
            { key: 'report_same_target', label: 'Reports against the same player', unit: 'reports', value: 5, min: 2, step: 1, help: 'Reports of one account against the same player within 7 days (harassment through reports).' },
        ],
    },
    {
        group: 'Accounts',
        items: [
            { key: 'shared_hardware_accounts', label: 'Accounts per hardware', unit: 'accounts', value: 3, min: 2, step: 1, help: 'Number of accounts that logged in with the same hardware id (multi accounting, bot farms).' },
        ],
    },
];

/**
 * Detection rules
 *
 * severity: 1 = low, 2 = medium, 3 = high
 */
const RULES = {
    xp_rate:         { label: 'XP rate', severity: 2, thresholds: ['xp_per_hour'], help: 'Too much XP per hour' },
    gold_rate:       { label: 'Gold rate', severity: 2, thresholds: ['gold_per_minute'], help: 'Too much gold per minute' },
    drop_rate:       { label: 'Item drops', severity: 2, thresholds: ['items_per_minute'], help: 'Too many item drops per minute' },
    playtime:        { label: 'Playtime', severity: 1, thresholds: ['playtime_hours_per_day'], help: 'Plays (almost) around the clock' },
    chat_toxic:      { label: 'Offensive chat', severity: 2, thresholds: ['chat_bad_words_per_day', 'chat_bad_word_level'], help: 'Messages with bad words' },
    chat_spam:       { label: 'Chat spam', severity: 2, thresholds: ['chat_spam_repeats', 'chat_spam_window_minutes'], help: 'The same message again and again (e.g. gold sellers)' },
    bot_path:        { label: 'Repeated route', severity: 3, thresholds: ['path_similarity', 'path_min_sessions', 'path_grid_size'], help: 'Walks the same route in several sessions' },
    input_script:    { label: 'Input script', severity: 3, thresholds: ['input_min_interval_ms', 'input_fast_ratio', 'input_interval_cv', 'input_min_samples'], help: 'Inhumanly fast or regular skill inputs' },
    apm:             { label: 'APM', severity: 2, thresholds: ['apm_max'], help: 'Inhumanly high actions per minute' },
    streak:          { label: 'Win/loss streak', severity: 2, thresholds: ['streak_length'], help: 'Very long win or loss streak' },
    short_matches:   { label: 'Short matches', severity: 2, thresholds: ['short_match_seconds', 'short_match_count'], help: 'Many suspiciously short PvP matches' },
    auction_price:   { label: 'Auction price', severity: 2, thresholds: ['auction_price_low_factor', 'auction_price_high_factor', 'auction_min_samples'], help: 'Auction far below/above the usual price' },
    trade_gold:      { label: 'One-sided trade', severity: 3, thresholds: ['trade_one_sided_gold'], help: 'Large amount of gold traded for nothing' },
    shared_hardware: { label: 'Shared hardware', severity: 1, thresholds: ['shared_hardware_accounts'], help: 'Several accounts on the same hardware' },
    item_dupe:       { label: 'Duplicated item', severity: 3, thresholds: [], help: 'The same item id exists more than once' },
    item_origin:     { label: 'Item without origin', severity: 2, thresholds: ['item_origin_grace_minutes'], help: 'Item exists, but there is no record of how it was obtained' },
    item_quantity:   { label: 'Grown stack', severity: 3, thresholds: ['item_quantity_tolerance'], help: 'A stack contains more items than were ever added to it' },
    false_reports:   { label: 'False reports', severity: 2, thresholds: ['report_min_resolved', 'report_false_ratio'], help: 'Most reports of this player were unfounded' },
    report_spam:     { label: 'Report spam', severity: 2, thresholds: ['report_max_per_day', 'report_same_target'], help: 'Very many reports, or again and again against the same player' },
};

const DEFAULTS = {};
for (const group of THRESHOLDS) {
    for (const item of group.items) {
        DEFAULTS[item.key] = item;
    }
}

for (const id of Object.keys(RULES)) {
    DEFAULTS['rule.' + id] = { key: 'rule.' + id, label: RULES[id].label, unit: 'on/off', value: 1, min: 0, max: 1, step: 1, help: RULES[id].help };
}

/**
 * Current thresholds (defaults overwritten by the stored values)
 *
 * @param {import('./db').Database} db
 *
 * @return {Record<string, number>}
 */
function thresholds (db)
{
    const values = {};
    for (const [key, item] of Object.entries(DEFAULTS)) {
        values[key] = item.value;
    }

    for (const row of db.all('SELECT mod_threshold_key AS k, mod_threshold_value AS v FROM mod_threshold')) {
        if (row.k in values && row.v !== null) {
            values[row.k] = Number(row.v);
        }
    }

    return values;
}

/**
 * Store thresholds
 *
 * @param {import('./db').Database} db
 * @param {Record<string, unknown>} input
 * @param {number} moderator
 *
 * @return {{saved:string[], errors:Record<string, string>}}
 */
function saveThresholds (db, input, moderator)
{
    const errors = {};
    const valid  = {};

    for (const [key, raw] of Object.entries(input)) {
        const def = DEFAULTS[key];
        if (def === undefined) {
            continue;
        }

        const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
        if (!Number.isFinite(value)) {
            errors[key] = 'Not a number';
        } else if (def.min !== undefined && value < def.min) {
            errors[key] = 'Minimum is ' + def.min;
        } else if (def.max !== undefined && value > def.max) {
            errors[key] = 'Maximum is ' + def.max;
        } else {
            valid[key] = value;
        }
    }

    if (Object.keys(errors).length > 0) {
        return { saved: [], errors };
    }

    const now = Math.floor(Date.now() / 1000);
    db.transaction(() => {
        for (const [key, value] of Object.entries(valid)) {
            db.run(
                `INSERT INTO mod_threshold (mod_threshold_key, mod_threshold_value, mod_threshold_updated, mod_threshold_updated_by)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (mod_threshold_key) DO UPDATE SET
                    mod_threshold_value = excluded.mod_threshold_value,
                    mod_threshold_updated = excluded.mod_threshold_updated,
                    mod_threshold_updated_by = excluded.mod_threshold_updated_by`,
                key, value, now, moderator
            );
        }
    });

    return { saved: Object.keys(valid), errors };
}

module.exports = { THRESHOLDS, RULES, DEFAULTS, thresholds, saveThresholds };
