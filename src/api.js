/**
 * JSON API of the moderation tool
 */
'use strict';

const { HttpError } = require('./http');
const feeds  = require('./feeds');
const stats  = require('./stats');
const rules  = require('./rules');
const { detect, resetBadWordCache } = require('./detect');
const { now, sqlDate, levelFromXp, parseSqlDate } = require('./util');
const items  = require('./items');
const quests = require('./quests');
const { locate } = require('./location');

const REPORT_CATEGORIES = { cheating: 'Cheating', botting: 'Botting', exploit: 'Exploit / bug abuse', chat: 'Chat abuse', harassment: 'Harassment', scam: 'Scam / RMT', name: 'Offensive name', other: 'Other' };
const REPORT_STATUS = { open: 'open', action: 'action taken', rejected: 'no violation', duplicate: 'duplicate' };

const STATUS = { 0: 'inactive', 1: 'active', 2: 'banned' };
const ROLES  = { 0: 'Player', 1: 'Developer', 2: 'Administrator' };

/**
 * @param {import('./http').Router} router
 * @param {import('./db').Database} db
 * @param {import('./live').Live} live
 */
function register (router, db, live)
{
    const action = (moderator, account, character, type, detail) => {
        db.run(
            'INSERT INTO mod_action (mod_action_moderator, mod_action_account, mod_action_character, mod_action_type, mod_action_detail, mod_action_time) VALUES (?, ?, ?, ?, ?, ?)',
            moderator, account, character ?? null, type, typeof detail === 'string' ? detail : JSON.stringify(detail ?? {}), now()
        );
    };

    const accountOr404 = (id) => {
        const account = db.get(
            `SELECT account_id AS id, account_name AS name, account_email AS email, account_created AS created, account_lastlogin AS lastLogin,
                    account_status AS status, account_role AS role, account_muted_until AS mutedUntil, account_report_blocked_until AS reportBlockedUntil, account_banned_until AS bannedUntil, account_country AS country
             FROM account WHERE account_id = ?`,
            Number(id)
        );

        if (account === null) {
            throw new HttpError(404, 'Account not found');
        }

        return account;
    };

    const days = (q, fallback = 14) => q.int('days', fallback, 1, 90);

    /** limits for the highlighting of statistics */
    const limits = () => {
        const th = rules.thresholds(db);

        return {
            goldPerMinute: th.gold_per_minute,
            xpPerMinute: th.xp_per_hour / 60,
            playtime5: th.playtime_hours_per_day * 5 * 3600,
            maxApm: th.apm_max,
            dropsPerMinute: th.items_per_minute,
        };
    };

    // -----------------------------------------------------------------------------------------------------------------
    // meta, dashboard, search
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/meta', () => ({
        zones: db.all('SELECT zone_id AS id, zone_name AS name, zone_type AS type FROM zone ORDER BY zone_name'),
        servers: db.all('SELECT server_id AS id, server_name AS name FROM server ORDER BY server_id'),
        channels: feeds.CHANNELS,
        rarities: db.all('SELECT item_rarity_id AS id, item_rarity_name AS name FROM item_rarity ORDER BY item_rarity_id'),
        rules: Object.fromEntries(Object.entries(rules.RULES).map(([id, r]) => [id, { label: r.label, severity: r.severity, help: r.help }])),
        roles: ROLES,
        reportCategories: REPORT_CATEGORIES,
        reportStatus: REPORT_STATUS,
        equipmentTypes: db.all('SELECT equipment_type_id AS id, equipment_type_name AS name FROM equipment_type ORDER BY equipment_type_name'),
        instances: db.all('SELECT instance_id AS id, instance_name AS name, instance_type AS type, instance_size AS size FROM instance ORDER BY instance_type, instance_name, instance_size'),
        shortMatchSeconds: rules.thresholds(db).short_match_seconds,
        maxApm: rules.thresholds(db).apm_max,
    }));

    router.get('/api/dashboard', () => {
        const t = now();
        const hour = t - 3600;
        const hours = [];
        for (let i = 23; i >= 0; --i) {
            hours.push({ hour: Math.floor((t - i * 3600) / 3600), chat: 0, gold: 0, drops: 0, trades: 0 });
        }

        const fill = (rows, key) => {
            for (const row of rows) {
                const entry = hours.find((h) => h.hour === row.hour);
                if (entry !== undefined) {
                    entry[key] = row.value ?? 0;
                }
            }
        };

        const since = (Math.floor(t / 3600) - 23) * 3600;
        fill(db.all('SELECT chat_message_time / 3600 AS hour, COUNT(*) AS value FROM chat_message WHERE chat_message_time >= ? GROUP BY hour', since), 'chat');
        fill(db.all("SELECT log_gold_transaction_time / 3600 AS hour, SUM(log_gold_transaction_amount) AS value FROM log_gold_transaction WHERE log_gold_transaction_time >= ? AND log_gold_transaction_sign = 1 AND log_gold_transaction_source IN ('loot', 'quest', 'vendor') GROUP BY hour", since), 'gold');
        fill(db.all("SELECT log_item_transaction_time / 3600 AS hour, COUNT(*) AS value FROM log_item_transaction WHERE log_item_transaction_time >= ? AND log_item_transaction_source = 'loot' GROUP BY hour", since), 'drops');
        fill(db.all('SELECT trade_transaction_created / 3600 AS hour, COUNT(*) AS value FROM trade_transaction WHERE trade_transaction_created >= ? GROUP BY hour', since), 'trades');

        return {
            status: live.status(),
            lastHour: {
                chat: db.value('SELECT COUNT(*) FROM chat_message WHERE chat_message_time >= ?', hour),
                flaggedChat: db.value('SELECT COUNT(*) FROM chat_message m JOIN log_message l ON l.log_message_ref = m.chat_message_id WHERE m.chat_message_time >= ?', hour),
                gold: db.value("SELECT COALESCE(SUM(log_gold_transaction_amount), 0) FROM log_gold_transaction WHERE log_gold_transaction_time >= ? AND log_gold_transaction_sign = 1 AND log_gold_transaction_source IN ('loot', 'quest', 'vendor')", hour),
                drops: db.value("SELECT COUNT(*) FROM log_item_transaction WHERE log_item_transaction_time >= ? AND log_item_transaction_source = 'loot'", hour),
                trades: db.value('SELECT COUNT(*) FROM trade_transaction WHERE trade_transaction_created >= ?', hour),
            },
            hours: hours.map((h) => ({ ...h, label: sqlDate(h.hour * 3600).slice(11, 16) })),
            rules: db.all("SELECT mod_flag_rule AS rule, COUNT(*) AS count, MAX(mod_flag_severity) AS severity FROM mod_flag WHERE mod_flag_status = 'open' GROUP BY mod_flag_rule ORDER BY severity DESC, count DESC"),
            suspects: db.all(
                `SELECT f.mod_flag_account AS account, a.account_name AS name, COUNT(*) AS flags, MAX(f.mod_flag_severity) AS severity,
                        SUM(f.mod_flag_severity) AS score, GROUP_CONCAT(DISTINCT f.mod_flag_rule) AS rules, a.account_status AS status
                 FROM mod_flag f JOIN account a ON a.account_id = f.mod_flag_account
                 WHERE f.mod_flag_status = 'open'
                 GROUP BY f.mod_flag_account ORDER BY score DESC, flags DESC LIMIT 12`
            ).map((s) => ({ ...s, rules: String(s.rules ?? '').split(',') })),
            recentActions: actions({ limit: 8 }),
        };
    });

    router.get('/api/search', ({ q }) => {
        const text = q.str('q');
        if (text.length < 1) {
            return { accounts: [], characters: [], guilds: [], items: [] };
        }

        const like = '%' + text + '%';
        const id = /^\d+$/.test(text) ? Number(text) : -1;

        return {
            accounts: db.all(
                `SELECT account_id AS id, account_name AS name, account_email AS email, account_status AS status, account_role AS role
                 FROM account WHERE account_name LIKE ? OR account_email LIKE ? OR account_id = ? ORDER BY account_name LIMIT 25`,
                like, like, id
            ),
            characters: db.all(
                `SELECT c.character_id AS id, c.character_name AS name, c.character_account AS account, a.account_name AS accountName, c.character_xp AS xp,
                        cl.class_name AS className
                 FROM character c LEFT JOIN account a ON a.account_id = c.character_account LEFT JOIN class cl ON cl.class_id = c.character_class
                 WHERE c.character_name LIKE ? OR c.character_id = ? ORDER BY c.character_name LIMIT 25`,
                like, id
            ).map((c) => ({ ...c, level: levelFromXp(db, c.xp ?? 0) })),
            guilds: db.all('SELECT guild_id AS id, guild_name AS name, guild_tag AS tag FROM guild WHERE guild_name LIKE ? OR guild_tag LIKE ? OR guild_id = ? ORDER BY guild_name LIMIT 10', like, like, id),
            items: text.length >= 8 ? db.all(
                `SELECT DISTINCT ii.item_instance_uid AS uid, COALESCE(iv.item_individual_name, it.item_name, 'Unknown item') AS name
                 FROM item_instance ii LEFT JOIN item it ON it.item_id = ii.item_instance_item LEFT JOIN item_individual iv ON iv.item_individual_id = ii.item_instance_individual
                 WHERE ii.item_instance_uid LIKE ? LIMIT 10`,
                text + '%'
            ) : [],
        };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // players
    // -----------------------------------------------------------------------------------------------------------------

    const characterList = (where, ...params) => {
        const t = now();

        return db.all(
            `SELECT c.character_id AS id, c.character_name AS name, c.character_account AS account, c.character_xp AS xp, c.character_playtime AS playtime,
                    c.character_created AS created, c.character_season AS season, c.character_hardcore AS hardcore, c.character_dead AS dead,
                    c.character_item_level AS itemLevel, cl.class_name AS className, r.race_name AS raceName, s.server_name AS serverName,
                    g.guild_name AS guildName, g.guild_id AS guild,
                    (SELECT MAX(p.log_play_time_start) FROM log_play_time p WHERE p.log_play_time_character = c.character_id) AS lastSession,
                    EXISTS (SELECT 1 FROM log_play_time p WHERE p.log_play_time_character = c.character_id AND p.log_play_time_end IS NULL AND p.log_play_time_start > ?) AS online
             FROM character c
             LEFT JOIN class cl ON cl.class_id = c.character_class
             LEFT JOIN race r ON r.race_id = c.character_race
             LEFT JOIN server s ON s.server_id = c.character_server
             LEFT JOIN guild g ON g.guild_id = c.character_guild
             WHERE ` + where + ' ORDER BY c.character_xp DESC',
            t - 86400, ...params
        ).map((c) => ({ ...c, level: levelFromXp(db, c.xp ?? 0), online: c.online === 1 }));
    };

    const flagRows = (where, ...params) => db.all(
        `SELECT f.mod_flag_id AS id, f.mod_flag_rule AS rule, f.mod_flag_account AS account, a.account_name AS accountName,
                f.mod_flag_character AS character, c.character_name AS characterName, f.mod_flag_ref AS ref, f.mod_flag_severity AS severity,
                f.mod_flag_value AS value, f.mod_flag_threshold AS threshold, f.mod_flag_detail AS detail, f.mod_flag_first_seen AS firstSeen,
                f.mod_flag_last_seen AS lastSeen, f.mod_flag_hits AS hits, f.mod_flag_status AS status, f.mod_flag_reviewer AS reviewer,
                r.account_name AS reviewerName, f.mod_flag_reviewed AS reviewed, f.mod_flag_note AS note, a.account_status AS accountStatus
         FROM mod_flag f
         LEFT JOIN account a ON a.account_id = f.mod_flag_account
         LEFT JOIN character c ON c.character_id = f.mod_flag_character
         LEFT JOIN account r ON r.account_id = f.mod_flag_reviewer
         WHERE ` + where,
        ...params
    ).map((f) => {
        let detail = {};
        try {
            detail = JSON.parse(f.detail ?? '{}');
        } catch {
            // keep empty
        }

        return { ...f, detail, label: rules.RULES[f.rule]?.label ?? f.rule };
    });

    /** names of the characters and accounts that the details of flags refer to (trade partners, auction buyers, ...) */
    const withNames = (flags) => {
        const characters = new Set();
        const accounts = new Set();
        for (const f of flags) {
            for (const t of f.detail.trades ?? []) characters.add(t.partner);
            for (const a of f.detail.auctions ?? []) { characters.add(a.seller); characters.add(a.buyer); }
            for (const a of f.detail.accounts ?? []) accounts.add(a);
            for (const c of f.detail.copies ?? []) {
                if (c.ownerType === 'character') characters.add(c.owner);
                if (c.ownerType === 'account') accounts.add(c.owner);
            }
        }

        characters.delete(null);
        characters.delete(undefined);
        const names = {};
        if (characters.size > 0) {
            for (const c of db.all('SELECT character_id AS id, character_name AS name FROM character WHERE character_id IN (' + [...characters].map(() => '?').join(',') + ')', ...characters)) {
                names['c' + c.id] = c.name;
            }
        }

        if (accounts.size > 0) {
            for (const a of db.all('SELECT account_id AS id, account_name AS name FROM account WHERE account_id IN (' + [...accounts].map(() => '?').join(',') + ')', ...accounts)) {
                names['a' + a.id] = a.name;
            }
        }

        for (const f of flags) {
            f.names = names;
        }

        return flags;
    };

    const actions = ({ account = null, limit = 50 }) => db.all(
        `SELECT x.mod_action_id AS id, x.mod_action_type AS type, x.mod_action_detail AS detail, x.mod_action_time AS time,
                x.mod_action_account AS account, a.account_name AS accountName, x.mod_action_character AS character, c.character_name AS characterName,
                x.mod_action_moderator AS moderator, m.account_name AS moderatorName
         FROM mod_action x
         LEFT JOIN account a ON a.account_id = x.mod_action_account
         LEFT JOIN account m ON m.account_id = x.mod_action_moderator
         LEFT JOIN character c ON c.character_id = x.mod_action_character
         WHERE (? IS NULL OR x.mod_action_account = ?)
         ORDER BY x.mod_action_id DESC LIMIT ?`,
        account, account, limit
    ).map((x) => {
        try {
            x.detail = JSON.parse(x.detail);
        } catch {
            // plain text
        }

        return x;
    });

    router.get('/api/online', () => {
        const t = now();

        return db.all(
            `SELECT p.log_play_time_character AS character, c.character_name AS name, c.character_account AS account, a.account_name AS accountName,
                    a.account_status AS status, c.character_xp AS xp, cl.class_name AS className, s.server_name AS serverName, p.log_play_time_start AS start,
                    (SELECT z.zone_name FROM log_snapshot sn JOIN zone z ON z.zone_id = sn.log_snapshot_area WHERE sn.log_snapshot_session = p.log_play_time_id ORDER BY sn.log_snapshot_time DESC LIMIT 1) AS zoneName,
                    (SELECT COUNT(*) FROM mod_flag f WHERE f.mod_flag_account = c.character_account AND f.mod_flag_status = 'open') AS flags
             FROM log_play_time p
             JOIN character c ON c.character_id = p.log_play_time_character
             LEFT JOIN account a ON a.account_id = c.character_account
             LEFT JOIN class cl ON cl.class_id = c.character_class
             LEFT JOIN server s ON s.server_id = c.character_server
             WHERE p.log_play_time_end IS NULL AND p.log_play_time_start > ?
             ORDER BY flags DESC, p.log_play_time_start`,
            t - 86400
        ).map((c) => {
            const location = locate(db, c.character);

            return { ...c, level: levelFromXp(db, c.xp ?? 0), zoneName: location.zone?.name ?? c.zoneName, instance: location.instance };
        });
    });

    router.get('/api/players/:id', ({ params, q }) => {
        const account = accountOr404(params.id);
        const window = days(q);
        const characters = characterList('c.character_account = ?', account.id).map((c) => ({ ...c, location: c.online ? locate(db, c.id) : null }));
        const result = stats.accountStats(db, account.id, window);

        const logins = db.all(
            `SELECT log_auth_time AS time, log_auth_end AS end, log_auth_ip AS ip, log_auth_hardware AS hardware, log_auth_status AS status, log_auth_origin AS origin
             FROM log_auth WHERE log_auth_account = ? ORDER BY log_auth_time DESC LIMIT 30`,
            account.id
        );

        const hardware = [...new Set(logins.map((l) => l.hardware).filter(Boolean))];
        const ips = [...new Set(logins.map((l) => l.ip).filter(Boolean))];
        const related = hardware.length + ips.length === 0 ? [] : db.all(
            `SELECT DISTINCT a.account_id AS id, a.account_name AS name, a.account_status AS status,
                    MAX(l.log_auth_hardware IN (` + (hardware.map(() => '?').join(',') || "''") + `)) AS sameHardware,
                    MAX(l.log_auth_ip IN (` + (ips.map(() => '?').join(',') || "''") + `)) AS sameIp
             FROM log_auth l JOIN account a ON a.account_id = l.log_auth_account
             WHERE l.log_auth_account != ? AND (l.log_auth_hardware IN (` + (hardware.map(() => '?').join(',') || "''") + `) OR l.log_auth_ip IN (` + (ips.map(() => '?').join(',') || "''") + `))
             GROUP BY a.account_id`,
            ...hardware, ...ips, account.id, ...hardware, ...ips
        );

        const auctions = db.all(
            `SELECT au.auction_id AS id, au.auction_item AS item, it.item_name AS itemName, au.auction_quantity AS quantity, au.auction_prize_min AS price,
                    au.auction_start AS start, au.auction_state AS state, au.auction_character AS seller, cs.character_name AS sellerName,
                    tx.auction_transaction_buyer AS buyer, cb.character_name AS buyerName, tx.auction_transaction_datetime AS sold,
                    (SELECT AVG(x.auction_prize_min * 1.0 / MAX(1, x.auction_quantity)) FROM auction x WHERE x.auction_item = au.auction_item) AS avgUnit,
                    CASE WHEN cs.character_account = ? THEN 'sell' ELSE 'buy' END AS side
             FROM auction au
             LEFT JOIN item it ON it.item_id = au.auction_item
             LEFT JOIN character cs ON cs.character_id = au.auction_character
             LEFT JOIN auction_transaction tx ON tx.auction_transaction_auction = au.auction_id
             LEFT JOIN character cb ON cb.character_id = tx.auction_transaction_buyer
             WHERE cs.character_account = ? OR cb.character_account = ?
             ORDER BY au.auction_start DESC LIMIT 40`,
            account.id, account.id, account.id
        );

        const achievements = db.get(
            'SELECT COUNT(*) AS tiers, COUNT(DISTINCT account_achievement_tier_type) AS types FROM account_achievement_tier WHERE account_achievement_tier_account = ?',
            account.id
        );

        return {
            account: {
                ...account, statusName: STATUS[account.status] ?? 'unknown', roleName: ROLES[account.role] ?? 'Player', muted: (account.mutedUntil ?? 0) > now(),
                reportBlocked: (account.reportBlockedUntil ?? 0) > now(),
            },
            characters,
            days: window,
            stats: result.total,
            limits: limits(),
            characterStats: result.characters,
            daily: stats.daily(db, { account: account.id }, 14),
            hourly: stats.hourly(db, { account: account.id }),
            flags: withNames(flagRows('f.mod_flag_account = ? ORDER BY f.mod_flag_status = \'open\' DESC, f.mod_flag_last_seen DESC LIMIT 50', account.id)),
            logins,
            related,
            auctions,
            achievements,
            actions: actions({ account: account.id, limit: 30 }),
            unread: db.value('SELECT COUNT(*) FROM mod_support_message WHERE mod_support_message_account = ? AND mod_support_message_direction = 1 AND mod_support_message_read = 0', account.id),
            reports: reportSummary(account.id),
            online: characters.some((c) => c.online),
        };
    });

    router.post('/api/players/:id/status', ({ params, body, user }) => {
        const account = accountOr404(params.id);
        const reason = String(body.reason ?? '').trim().slice(0, 500);
        const t = now();

        if (account.role > 0 && user.account.role < 2) {
            throw new HttpError(403, 'Only administrators can change the status of team accounts');
        }

        if (account.id === user.account.id) {
            throw new HttpError(400, 'You cannot change the status of your own account');
        }

        switch (body.action) {
            case 'mute': {
                const minutes = Math.round(Number(body.minutes));
                if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60 * 24 * 365) {
                    throw new HttpError(422, 'Invalid duration', { minutes: 'Between 1 minute and 1 year' });
                }

                db.run('UPDATE account SET account_muted_until = ? WHERE account_id = ?', t + minutes * 60, account.id);
                action(user.account.id, account.id, null, 'mute', { minutes, reason });
                break;
            }
            case 'unmute':
                db.run('UPDATE account SET account_muted_until = NULL WHERE account_id = ?', account.id);
                action(user.account.id, account.id, null, 'unmute', { reason });
                break;
            case 'ban':
                if (reason === '') {
                    throw new HttpError(422, 'A reason is required', { reason: 'Please enter a reason' });
                }

                {
                    // optional duration, empty / 0 = permanent
                    const minutes = body.minutes === undefined || body.minutes === null || body.minutes === '' ? 0 : Math.round(Number(body.minutes));
                    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 * 24 * 3650) {
                        throw new HttpError(422, 'Invalid duration', { minutes: 'Between 1 minute and 10 years, or permanent' });
                    }

                    db.run('UPDATE account SET account_status = 2, account_banned_until = ? WHERE account_id = ?', minutes > 0 ? t + minutes * 60 : null, account.id);
                    db.run('DELETE FROM mod_session WHERE mod_session_account = ?', account.id);
                    action(user.account.id, account.id, null, 'ban', { minutes: minutes || undefined, permanent: minutes === 0, reason });
                }
                break;
            case 'unban':
                db.run('UPDATE account SET account_status = 1, account_banned_until = NULL WHERE account_id = ?', account.id);
                action(user.account.id, account.id, null, 'unban', { reason });
                break;
            case 'block_reports': {
                const minutes = Math.round(Number(body.minutes));
                if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60 * 24 * 3650) {
                    throw new HttpError(422, 'Invalid duration', { minutes: 'Between 1 minute and 10 years' });
                }

                db.run('UPDATE account SET account_report_blocked_until = ? WHERE account_id = ?', t + minutes * 60, account.id);
                action(user.account.id, account.id, null, 'report_block', { minutes, reason });
                break;
            }
            case 'unblock_reports':
                db.run('UPDATE account SET account_report_blocked_until = NULL WHERE account_id = ?', account.id);
                action(user.account.id, account.id, null, 'report_unblock', { reason });
                break;
            default:
                throw new HttpError(422, 'Unknown action');
        }

        return { ok: true, message: 'Account updated' };
    });

    router.post('/api/players/:id/note', ({ params, body, user }) => {
        const account = accountOr404(params.id);
        const text = String(body.text ?? '').trim();
        if (text === '' || text.length > 2000) {
            throw new HttpError(422, 'Please enter a note (max. 2000 characters)', { text: 'Required' });
        }

        action(user.account.id, account.id, body.character ? Number(body.character) : null, 'note', text);

        return { ok: true, message: 'Note saved' };
    });

    // achievements -----------------------------------------------------------------------------------------------------

    const achievementTypes = () => db.all(
        `SELECT t.achievement_type_id AS id, t.achievement_type_name AS name, t.achievement_type_desc AS description,
                ac.achievement_category_name AS category, t.achievement_type_score1 AS s1, t.achievement_type_score2 AS s2,
                t.achievement_type_score3 AS s3, t.achievement_type_score4 AS s4, t.achievement_type_score5 AS s5
         FROM achievement_type t LEFT JOIN achievement_category ac ON ac.achievement_category_id = t.achievement_type_category
         ORDER BY ac.achievement_category_name, t.achievement_type_name`
    ).map((t) => {
        const tiers = [...new Set([t.s1, t.s2, t.s3, t.s4, t.s5].filter((v) => v !== null))].sort((a, b) => a - b);

        return { id: t.id, name: t.name, description: t.description, category: t.category ?? 'Other', tiers: tiers.length > 0 ? tiers : [1] };
    });

    router.get('/api/players/:id/achievements', ({ params }) => {
        const account = accountOr404(params.id);
        const unlocked = db.all(
            'SELECT account_achievement_tier_type AS type, account_achievement_tier_tier AS tier, account_achievement_tier_datetime AS date FROM account_achievement_tier WHERE account_achievement_tier_account = ?',
            account.id
        );
        const progress = new Map(db.all(
            'SELECT account_achievement_type AS type, MAX(account_achievement_score) AS score FROM account_achievement WHERE account_achievement_account = ? GROUP BY account_achievement_type',
            account.id
        ).map((p) => [p.type, p.score]));

        return {
            achievements: achievementTypes().map((type) => ({
                ...type,
                progress: progress.get(type.id) ?? 0,
                unlocked: unlocked.filter((u) => u.type === type.id).map((u) => ({ tier: u.tier, date: u.date })).sort((a, b) => a.tier - b.tier),
            })),
        };
    });

    router.post('/api/players/:id/achievements', ({ params, body, user }) => {
        const account = accountOr404(params.id);
        const type = achievementTypes().find((t) => t.id === Number(body.type));
        const tier = Number(body.tier);
        const reason = String(body.reason ?? '').trim().slice(0, 500);

        if (type === undefined) {
            throw new HttpError(422, 'Unknown achievement', { type: 'Please select an achievement' });
        }

        if (!Number.isInteger(tier) || tier < 1 || tier > type.tiers.length) {
            throw new HttpError(422, 'Invalid tier', { tier: 'Between 1 and ' + type.tiers.length });
        }

        if (reason === '') {
            throw new HttpError(422, 'A reason is required', { reason: 'Please enter a reason (e.g. compensation for a bug)' });
        }

        const date = sqlDate(now());
        const added = [];

        db.transaction(() => {
            for (let i = 1; i <= tier; ++i) {
                const exists = db.value('SELECT COUNT(*) FROM account_achievement_tier WHERE account_achievement_tier_account = ? AND account_achievement_tier_type = ? AND account_achievement_tier_tier = ?', account.id, type.id, i);
                if (exists === 0) {
                    db.run('INSERT INTO account_achievement_tier (account_achievement_tier_account, account_achievement_tier_type, account_achievement_tier_tier, account_achievement_tier_datetime) VALUES (?, ?, ?, ?)', account.id, type.id, i, date);
                    added.push(i);
                }
            }

            // progress at least at the threshold of the tier
            const score = type.tiers[tier - 1];
            const progress = db.get('SELECT account_achievement_id AS id, account_achievement_score AS score FROM account_achievement WHERE account_achievement_account = ? AND account_achievement_type = ?', account.id, type.id);
            if (progress === null) {
                db.run('INSERT INTO account_achievement (account_achievement_account, account_achievement_type, account_achievement_score, account_achievement_datetime) VALUES (?, ?, ?, ?)', account.id, type.id, score, date);
            } else if ((progress.score ?? 0) < score) {
                db.run('UPDATE account_achievement SET account_achievement_score = ?, account_achievement_datetime = ? WHERE account_achievement_id = ?', score, date, progress.id);
            }

            action(user.account.id, account.id, null, 'achievement', { type: type.id, name: type.name, tier, added, reason });
        });

        return { ok: true, message: added.length === 0 ? type.name + ' tier ' + tier + ' was already unlocked' : 'Awarded ' + type.name + ' (tier ' + added.join(', ') + ')' };
    });

    router.post('/api/players/:id/achievements/revoke', ({ params, body, user }) => {
        const account = accountOr404(params.id);
        const type = achievementTypes().find((t) => t.id === Number(body.type));
        const tier = Number(body.tier);
        const reason = String(body.reason ?? '').trim().slice(0, 500);

        if (type === undefined || !Number.isInteger(tier) || tier < 1) {
            throw new HttpError(422, 'Invalid achievement');
        }

        if (reason === '') {
            throw new HttpError(422, 'A reason is required', { reason: 'Please enter a reason' });
        }

        const removed = db.run('DELETE FROM account_achievement_tier WHERE account_achievement_tier_account = ? AND account_achievement_tier_type = ? AND account_achievement_tier_tier >= ?', account.id, type.id, tier).changes;
        action(user.account.id, account.id, null, 'achievement_revoke', { type: type.id, name: type.name, tier, removed: Number(removed), reason });

        return { ok: true, message: 'Removed ' + removed + ' tier(s) of ' + type.name };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // characters
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/characters/:id', ({ params, q }) => {
        const character = characterList('c.character_id = ?', Number(params.id))[0];
        if (character === undefined) {
            throw new HttpError(404, 'Character not found');
        }

        const window = days(q);
        const account = character.account !== null ? accountOr404(character.account) : null;
        character.location = locate(db, character.id);

        const encounters = db.all(
            `SELECT e.encounter_id AS id, e.encounter_type AS type, e.encounter_difficulty AS mode, i.instance_name AS instance, e.encounter_start AS start,
                    e.encounter_duration AS duration, e.encounter_success AS success, (e.encounter_winner = m.encounter_member_team) AS won,
                    m.encounter_member_role AS role, m.encounter_member_damage AS damage, m.encounter_member_healing AS healing,
                    m.encounter_member_damage * 1.0 / NULLIF(e.encounter_duration, 0) AS dps, m.encounter_member_healing * 1.0 / NULLIF(e.encounter_duration, 0) AS hps,
                    m.encounter_member_apm AS apm, m.encounter_member_kills AS kills, m.encounter_member_deaths AS deaths
             FROM encounter_member m JOIN encounter e ON e.encounter_id = m.encounter_member_encounter LEFT JOIN instance i ON i.instance_id = e.encounter_instance
             WHERE m.encounter_member_character = ? ORDER BY e.encounter_start DESC LIMIT 40`,
            character.id
        );

        const sessions = db.all(
            `SELECT p.log_play_time_id AS id, p.log_play_time_start AS start, p.log_play_time_end AS end, p.log_play_time_xp AS xp,
                    (SELECT COUNT(*) FROM log_snapshot s WHERE s.log_snapshot_session = p.log_play_time_id) AS points,
                    (SELECT z.zone_name FROM log_snapshot s JOIN zone z ON z.zone_id = s.log_snapshot_area WHERE s.log_snapshot_session = p.log_play_time_id LIMIT 1) AS zoneName
             FROM log_play_time p WHERE p.log_play_time_character = ? ORDER BY p.log_play_time_start DESC LIMIT 30`,
            character.id
        );

        return {
            character,
            account,
            days: window,
            stats: stats.characterStats(db, character.id, window),
            limits: limits(),
            daily: stats.daily(db, { character: character.id }, 14),
            hourly: stats.hourly(db, { character: character.id }),
            encounters,
            sessions,
            inputs: inputAnalysis(character.id),
            flags: withNames(flagRows('f.mod_flag_character = ? ORDER BY f.mod_flag_last_seen DESC LIMIT 30', character.id)),
        };
    });

    /**
     * Skill input timing of the last 7 days: interval histogram and the most used combos
     */
    const inputAnalysis = (character) => {
        const rows = db.all(
            'SELECT log_skill_input_skill AS skill, log_skill_input_time AS time FROM log_skill_input WHERE log_skill_input_character = ? AND log_skill_input_time >= ? ORDER BY log_skill_input_time',
            character, (now() - 7 * 86400) * 1000
        );

        const histogram = new Array(30).fill(0); // 0-3000 ms in 100 ms steps
        const combos = new Map();
        let fast = 0;
        let count = 0;
        const th = rules.thresholds(db);

        for (let i = 1; i < rows.length; ++i) {
            const interval = rows[i].time - rows[i - 1].time;
            if (interval > 3000) {
                continue;
            }

            ++count;
            histogram[Math.min(29, Math.floor(interval / 100))]++;
            if (interval < th.input_min_interval_ms) {
                ++fast;
            }

            const key = rows[i - 1].skill + '>' + rows[i].skill;
            if (!combos.has(key)) {
                combos.set(key, []);
            }

            combos.get(key).push(interval);
        }

        const skillNames = new Map(db.all('SELECT skill_id AS id, skill_name AS name FROM skill').map((s) => [s.id, s.name]));
        const top = [...combos].filter(([, list]) => list.length >= 5).map(([key, list]) => {
            const mean = list.reduce((a, b) => a + b, 0) / list.length;
            const std = Math.sqrt(list.reduce((a, b) => a + (b - mean) * (b - mean), 0) / list.length);
            const [from, to] = key.split('>').map(Number);

            return { from: skillNames.get(from) ?? '#' + from, to: skillNames.get(to) ?? '#' + to, count: list.length, mean, std, cv: mean > 0 ? std / mean : 0 };
        }).sort((a, b) => b.count - a.count).slice(0, 10);

        return { inputs: rows.length, intervals: count, fast, fastRatio: count > 0 ? fast / count : 0, histogram, combos: top };
    };

    router.get('/api/characters/:id/location', ({ params }) => locate(db, Number(params.id)));

    router.get('/api/characters/:id/path', ({ params, q }) => {
        const id = Number(params.id);
        let session = q.int('session', null);
        if (session === null) {
            session = db.value('SELECT log_snapshot_session FROM log_snapshot WHERE log_snapshot_character = ? ORDER BY log_snapshot_time DESC LIMIT 1', id);
        }

        const points = session === null ? [] : db.all(
            `SELECT log_snapshot_location_x AS x, log_snapshot_location_y AS y, log_snapshot_time AS time, log_snapshot_area AS zone
             FROM log_snapshot WHERE log_snapshot_session = ? AND log_snapshot_character = ? ORDER BY log_snapshot_time`,
            session, id
        );

        // other sessions in the same zone, to compare the routes
        const zone = points[0]?.zone ?? null;
        const others = zone === null ? [] : db.all(
            `SELECT log_snapshot_session AS session, COUNT(*) AS points, MIN(log_snapshot_time) AS start
             FROM log_snapshot WHERE log_snapshot_character = ? AND log_snapshot_area = ? AND log_snapshot_session != ?
             GROUP BY log_snapshot_session ORDER BY start DESC LIMIT 5`,
            id, zone, session
        );

        const compare = others.map((o) => ({
            session: o.session,
            start: o.start,
            points: db.all('SELECT log_snapshot_location_x AS x, log_snapshot_location_y AS y FROM log_snapshot WHERE log_snapshot_session = ? ORDER BY log_snapshot_time', o.session),
        }));

        return { session, zone: zone === null ? null : db.get('SELECT zone_id AS id, zone_name AS name FROM zone WHERE zone_id = ?', zone), points, compare };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // rankings & feeds
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/rankings', ({ q }) => {
        const window = days(q, 14);

        return {
            days: window,
            rows: stats.ranking(db, window),
            limits: limits(),
        };
    });

    router.get('/api/chat', ({ q }) => feeds.chat(db, {
        before: q.int('before', undefined),
        channel: q.int('channel', undefined),
        account: q.int('account', undefined),
        character: q.int('character', undefined),
        zone: q.int('zone', undefined),
        server: q.int('server', undefined),
        q: q.str('q') || undefined,
        flagged: q.str('flagged') === '1' ? true : undefined,
    }, q.int('limit', 100, 1, 500)));

    /**
     * Messages before and after a message, in the same conversation
     *
     * scope: auto (whisper/encounter/guild/channel), channel, zone (all channels of the zone), player (everything the author wrote/received),
     *        whisper, encounter, guild
     */
    router.get('/api/chat/:id/context', ({ params, q }) => {
        const m = db.get(
            `SELECT m.chat_message_id AS id, m.chat_message_type AS channel, m.chat_message_time AS time, m.chat_message_character AS character,
                    m.chat_message_to AS toCharacter, m.chat_message_server AS server, m.chat_message_location AS zone, m.chat_message_encounter AS encounter,
                    (SELECT guild_member_guild FROM guild_member WHERE guild_member_character = m.chat_message_character LIMIT 1) AS guild
             FROM chat_message m WHERE m.chat_message_id = ?`,
            Number(params.id)
        );

        if (m === null) {
            throw new HttpError(404, 'Message not found');
        }

        const scopes = ['channel', 'zone', 'player'];
        if (m.channel === 6 && m.toCharacter) scopes.unshift('whisper');
        if (m.encounter) scopes.unshift('encounter');
        if (m.channel === 4 && m.guild) scopes.unshift('guild');

        let scope = q.str('scope', 'auto');
        if (scope === 'auto' || !scopes.includes(scope)) {
            scope = scopes[0];
        }

        let where = '';
        let args = [];
        switch (scope) {
            case 'whisper':
                where = 'chat_message_type = 6 AND ((chat_message_character = ? AND chat_message_to = ?) OR (chat_message_character = ? AND chat_message_to = ?))';
                args = [m.character, m.toCharacter, m.toCharacter, m.character];
                break;
            case 'encounter':
                where = 'chat_message_encounter = ?';
                args = [m.encounter];
                break;
            case 'guild':
                where = 'chat_message_type = 4 AND chat_message_character IN (SELECT guild_member_character FROM guild_member WHERE guild_member_guild = ?)';
                args = [m.guild];
                break;
            case 'zone':
                where = 'chat_message_server IS ? AND chat_message_location IS ? AND chat_message_encounter IS NULL';
                args = [m.server, m.zone];
                break;
            case 'player':
                where = '(chat_message_character = ? OR chat_message_to = ?)';
                args = [m.character, m.character];
                break;
            default: {
                // say and zone chat are local, the other channels are server wide
                const local = [1, 2].includes(m.channel);
                where = 'chat_message_type = ? AND chat_message_server IS ?' + (local ? ' AND chat_message_location IS ?' : '') + (m.encounter ? ' AND chat_message_encounter = ?' : '');
                args = [m.channel, m.server, ...(local ? [m.zone] : []), ...(m.encounter ? [m.encounter] : [])];
            }
        }

        const before = q.int('before', 25, 0, 500);
        const after = q.int('after', 25, 0, 500);
        const earlier = db.all(
            'SELECT chat_message_id AS id FROM chat_message WHERE ' + where + ' AND (chat_message_time < ? OR (chat_message_time = ? AND chat_message_id < ?)) ORDER BY chat_message_time DESC, chat_message_id DESC LIMIT ?',
            ...args, m.time, m.time, m.id, before
        ).map((r) => r.id);
        const later = db.all(
            'SELECT chat_message_id AS id FROM chat_message WHERE ' + where + ' AND (chat_message_time > ? OR (chat_message_time = ? AND chat_message_id > ?)) ORDER BY chat_message_time ASC, chat_message_id ASC LIMIT ?',
            ...args, m.time, m.time, m.id, after
        ).map((r) => r.id);

        return {
            focus: m.id,
            scope,
            scopes,
            before,
            after,
            moreBefore: earlier.length === before,
            moreAfter: later.length === after,
            messages: feeds.chat(db, { idList: [...earlier, m.id, ...later] }, before + after + 1),
        };
    });

    router.post('/api/chat/:id/review', ({ params, body, user }) => {
        const message = db.get('SELECT m.chat_message_id AS id, c.character_account AS account, m.chat_message_character AS character FROM chat_message m LEFT JOIN character c ON c.character_id = m.chat_message_character WHERE m.chat_message_id = ?', Number(params.id));
        if (message === null) {
            throw new HttpError(404, 'Message not found');
        }

        const value = { ok: 1, offensive: 2 }[body.action];
        if (value === undefined) {
            throw new HttpError(422, 'Unknown action');
        }

        const existing = db.get('SELECT log_message_id AS id FROM log_message WHERE log_message_ref = ?', message.id);
        if (existing === null) {
            db.run('INSERT INTO log_message (log_message_ref, log_message_warning_level_manual, log_message_review_action, log_message_reviewer1) VALUES (?, ?, ?, ?)', message.id, value === 2 ? 1 : 0, value, user.account.id);
        } else {
            db.run('UPDATE log_message SET log_message_review_action = ?, log_message_warning_level_manual = ?, log_message_reviewer1 = ? WHERE log_message_id = ?', value, value === 2 ? 1 : 0, user.account.id, existing.id);
        }

        action(user.account.id, message.account, message.character, 'chat_review', { message: message.id, result: body.action });

        return { ok: true, review: value };
    });

    router.get('/api/drops', ({ q }) => feeds.drops(db, {
        before: q.int('before', undefined),
        account: q.int('account', undefined),
        character: q.int('character', undefined),
        zone: q.int('zone', undefined),
        type: q.str('type') || undefined,
        source: q.str('source') || undefined,
        minRarity: q.int('minRarity', undefined),
        minGold: q.int('minGold', undefined),
    }, q.int('limit', 100, 1, 500)));

    router.get('/api/trades', ({ q }) => {
        const state = q.str('state');

        return feeds.trades(db, {
            state: state === '' ? undefined : Number(state),
            account: q.int('account', undefined),
            character: q.int('character', undefined),
            before: q.int('before', undefined),
            minGold: q.int('minGold', undefined),
            q: q.str('q') || undefined,
        }, q.int('limit', 100, 1, 500));
    });

    // -----------------------------------------------------------------------------------------------------------------
    // flags
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/flags', ({ q }) => {
        const where = ['1 = 1'];
        const params = [];
        const status = q.str('status', 'open');
        if (status !== 'all') {
            where.push('f.mod_flag_status = ?');
            params.push(status);
        }

        if (q.str('rule') !== '') {
            where.push('f.mod_flag_rule = ?');
            params.push(q.str('rule'));
        }

        if (q.int('severity', null) !== null) {
            where.push('f.mod_flag_severity >= ?');
            params.push(q.int('severity'));
        }

        if (q.int('account', null) !== null) {
            where.push('f.mod_flag_account = ?');
            params.push(q.int('account'));
        }

        return {
            flags: withNames(flagRows(where.join(' AND ') + ' ORDER BY f.mod_flag_severity DESC, f.mod_flag_last_seen DESC LIMIT ?', ...params, q.int('limit', 300, 1, 1000))),
            lastRun: lastDetection,
        };
    });

    router.post('/api/flags/run', () => {
        const result = runDetection();
        live.nudge();

        return { ok: true, message: result.created.length + ' new, ' + result.updated + ' updated (' + result.ms + ' ms)', ...result };
    });

    router.post('/api/flags/:id', ({ params, body, user }) => {
        const flag = db.get('SELECT mod_flag_id AS id, mod_flag_account AS account, mod_flag_character AS character, mod_flag_rule AS rule FROM mod_flag WHERE mod_flag_id = ?', Number(params.id));
        if (flag === null) {
            throw new HttpError(404, 'Flag not found');
        }

        if (!['open', 'dismissed', 'confirmed'].includes(body.status)) {
            throw new HttpError(422, 'Invalid status');
        }

        const note = String(body.note ?? '').trim().slice(0, 1000);
        db.run('UPDATE mod_flag SET mod_flag_status = ?, mod_flag_reviewer = ?, mod_flag_reviewed = ?, mod_flag_note = COALESCE(NULLIF(?, \'\'), mod_flag_note) WHERE mod_flag_id = ?', body.status, user.account.id, now(), note, flag.id);
        action(user.account.id, flag.account, flag.character, 'flag_' + body.status, { flag: flag.id, rule: flag.rule, note });
        live.nudge();

        return { ok: true };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // support chat
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/support', () => db.all(
        `SELECT m.mod_support_message_account AS account, a.account_name AS name, MAX(m.mod_support_message_time) AS last,
                SUM(m.mod_support_message_direction = 1 AND m.mod_support_message_read = 0) AS unread, COUNT(*) AS messages,
                (SELECT x.mod_support_message_content FROM mod_support_message x WHERE x.mod_support_message_account = m.mod_support_message_account ORDER BY x.mod_support_message_id DESC LIMIT 1) AS preview,
                (SELECT x.mod_support_message_direction FROM mod_support_message x WHERE x.mod_support_message_account = m.mod_support_message_account ORDER BY x.mod_support_message_id DESC LIMIT 1) AS lastDirection
         FROM mod_support_message m LEFT JOIN account a ON a.account_id = m.mod_support_message_account
         GROUP BY m.mod_support_message_account ORDER BY unread > 0 DESC, last DESC`
    ));

    router.get('/api/support/:account', ({ params }) => {
        const account = accountOr404(params.account);
        db.run('UPDATE mod_support_message SET mod_support_message_read = 1 WHERE mod_support_message_account = ? AND mod_support_message_direction = 1 AND mod_support_message_read = 0', account.id);

        return {
            account: { ...account, muted: (account.mutedUntil ?? 0) > now() },
            characters: characterList('c.character_account = ?', account.id).map((c) => ({ id: c.id, name: c.name, online: c.online, level: c.level })),
            messages: db.all(
                `SELECT m.mod_support_message_id AS id, m.mod_support_message_direction AS direction, m.mod_support_message_content AS text,
                        m.mod_support_message_time AS time, m.mod_support_message_moderator AS moderator, mo.account_name AS moderatorName,
                        c.character_name AS characterName, m.mod_support_message_delivered AS delivered
                 FROM mod_support_message m LEFT JOIN account mo ON mo.account_id = m.mod_support_message_moderator
                 LEFT JOIN character c ON c.character_id = m.mod_support_message_character
                 WHERE m.mod_support_message_account = ? ORDER BY m.mod_support_message_id`,
                account.id
            ),
        };
    });

    router.post('/api/support/:account', ({ params, body, user }) => {
        const account = accountOr404(params.account);
        const text = String(body.text ?? '').trim();
        if (text === '' || text.length > 1000) {
            throw new HttpError(422, 'Please enter a message (max. 1000 characters)', { text: 'Required' });
        }

        let character = body.character ? Number(body.character) : null;
        if (character !== null && db.value('SELECT COUNT(*) FROM character WHERE character_id = ? AND character_account = ?', character, account.id) === 0) {
            character = null;
        }

        const id = Number(db.run(
            `INSERT INTO mod_support_message (mod_support_message_account, mod_support_message_character, mod_support_message_moderator,
                mod_support_message_direction, mod_support_message_content, mod_support_message_time, mod_support_message_read, mod_support_message_delivered)
             VALUES (?, ?, ?, 0, ?, ?, 1, 0)`,
            account.id, character, user.account.id, text, now()
        ).lastInsertRowid);

        live.nudge();

        return { ok: true, id };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // configuration
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/config', () => {
        const values = rules.thresholds(db);
        const updated = new Map(db.all(
            'SELECT t.mod_threshold_key AS key, t.mod_threshold_updated AS time, a.account_name AS name FROM mod_threshold t LEFT JOIN account a ON a.account_id = t.mod_threshold_updated_by'
        ).map((r) => [r.key, r]));

        return {
            groups: rules.THRESHOLDS.map((g) => ({ group: g.group, items: g.items.map((i) => ({ ...i, default: i.value, value: values[i.key], updated: updated.get(i.key) ?? null })) })),
            rules: Object.entries(rules.RULES).map(([id, r]) => ({ id, ...r, enabled: values['rule.' + id] === 1, updated: updated.get('rule.' + id) ?? null })),
        };
    });

    router.post('/api/config', ({ body, user }) => {
        const result = rules.saveThresholds(db, body.values ?? {}, user.account.id);
        if (Object.keys(result.errors).length > 0) {
            throw new HttpError(422, 'Please check the values', result.errors);
        }

        if (result.saved.length > 0) {
            action(user.account.id, null, null, 'config', { changed: body.values });
            resetBadWordCache();
            scheduleDetection();
        }

        return { ok: true, message: result.saved.length + ' value(s) saved' };
    });

    router.get('/api/config/words', () => db.all(
        'SELECT bad_word_dictionary_id AS id, bad_word_dictionary_word AS word, bad_word_dictonary_language AS language, bad_word_dictionary_level AS level FROM bad_word_dictionary ORDER BY bad_word_dictionary_word'
    ));

    router.post('/api/config/words', ({ body, user }) => {
        const word = String(body.word ?? '').trim().toLowerCase();
        const level = Number(body.level ?? 0);
        const language = String(body.language ?? 'en').trim().slice(0, 5) || null;

        if (word.length < 2 || word.length > 60) {
            throw new HttpError(422, 'The word must have 2-60 characters', { word: '2-60 characters' });
        }

        if (![0, 1].includes(level)) {
            throw new HttpError(422, 'Invalid level', { level: '0 or 1' });
        }

        if (db.value('SELECT COUNT(*) FROM bad_word_dictionary WHERE LOWER(bad_word_dictionary_word) = ?', word) > 0) {
            throw new HttpError(422, 'The word is already in the list', { word: 'Already in the list' });
        }

        db.run('INSERT INTO bad_word_dictionary (bad_word_dictionary_word, bad_word_dictonary_language, bad_word_dictionary_level) VALUES (?, ?, ?)', word, language, level);
        action(user.account.id, null, null, 'word_add', { word, level });
        resetBadWordCache();

        return { ok: true, message: '"' + word + '" added' };
    });

    router.delete('/api/config/words/:id', ({ params, user }) => {
        const row = db.get('SELECT bad_word_dictionary_word AS word FROM bad_word_dictionary WHERE bad_word_dictionary_id = ?', Number(params.id));
        if (row === null) {
            throw new HttpError(404, 'Word not found');
        }

        db.run('DELETE FROM bad_word_dictionary WHERE bad_word_dictionary_id = ?', Number(params.id));
        action(user.account.id, null, null, 'word_remove', { word: row.word });
        resetBadWordCache();

        return { ok: true, message: '"' + row.word + '" removed' };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // items: inventories, give, remove, trace
    // -----------------------------------------------------------------------------------------------------------------

    const ownerOr404 = (type, id) => {
        const sql = {
            character: 'SELECT character_id AS id, character_name AS name, character_account AS account FROM character WHERE character_id = ?',
            account: 'SELECT account_id AS id, account_name AS name, account_id AS account FROM account WHERE account_id = ?',
            guild: 'SELECT guild_id AS id, guild_name AS name, NULL AS account FROM guild WHERE guild_id = ?',
        }[type];

        if (sql === undefined) {
            throw new HttpError(422, 'Unknown owner type');
        }

        const owner = db.get(sql, Number(id));
        if (owner === null) {
            throw new HttpError(404, 'Owner not found');
        }

        return owner;
    };

    router.get('/api/inventory', ({ q }) => {
        const type = q.str('type');
        const owner = ownerOr404(type, q.int('id', 0));

        return { owner: { type, ...owner }, items: items.inventory(db, type, owner.id, q.str('deleted') === '1') };
    });

    router.get('/api/items/templates', ({ q }) => {
        const text = q.str('q');
        if (text.length < 2) {
            return [];
        }

        return db.all(
            `SELECT it.item_id AS id, it.item_name AS name, ity.item_type_name AS type FROM item it LEFT JOIN item_type ity ON ity.item_type_id = it.item_type
             WHERE it.item_name LIKE ? ORDER BY it.item_name LIKE ? DESC, it.item_name LIMIT 20`,
            '%' + text + '%', text + '%'
        );
    });

    router.get('/api/items/trace', ({ q }) => {
        const value = q.str('uid');
        if (value === '') {
            throw new HttpError(422, 'Please enter an item id');
        }

        return items.trace(db, value);
    });

    router.post('/api/items/give', ({ body, user }) => {
        const type = String(body.ownerType ?? '');
        const owner = ownerOr404(type, body.owner);
        const reason = String(body.reason ?? '').trim().slice(0, 500);
        const quantity = Math.floor(Number(body.quantity ?? 1));

        if (reason === '') {
            throw new HttpError(422, 'A reason is required', { reason: 'Please enter a reason (e.g. raid item did not drop because of a bug)' });
        }

        if (!Number.isFinite(quantity) || quantity < 1 || quantity > 9999) {
            throw new HttpError(422, 'Invalid quantity', { quantity: '1 - 9999' });
        }

        let created = null;
        let name = '';

        db.transaction(() => {
            if (body.kind === 'equipment') {
                const e = body.equipment ?? {};
                const equipmentType = db.get('SELECT equipment_type_id AS id, equipment_type_name AS name FROM equipment_type WHERE equipment_type_id = ?', Number(e.type));
                const rarity = Number(e.rarity);
                const level = Number(e.level);
                name = String(e.name ?? '').trim().slice(0, 100) || (equipmentType?.name ?? '');

                if (equipmentType === null) {
                    throw new HttpError(422, 'Unknown equipment type', { 'equipment.type': 'Please select a type' });
                }

                if (!Number.isInteger(rarity) || rarity < 1 || rarity > 7) {
                    throw new HttpError(422, 'Invalid rarity', { 'equipment.rarity': 'Please select a rarity' });
                }

                if (!Number.isInteger(level) || level < 1 || level > 100) {
                    throw new HttpError(422, 'Invalid level', { 'equipment.level': '1 - 100' });
                }

                const character = type === 'character' ? owner.id : null;
                const individual = Number(db.run(
                    `INSERT INTO item_individual (item_individual_equipment_type, item_individual_name, item_individual_rarity, item_individual_level,
                        item_individual_character, item_individual_created) VALUES (?, ?, ?, ?, ?, ?)`,
                    equipmentType.id, name, rarity, level, character, sqlDate(now())
                ).lastInsertRowid);

                created = items.createInstance(db, { individual, quantity: 1, ownerType: type, owner: owner.id, origin: 'moderation', originRef: 'moderator:' + user.account.id, character });
            } else {
                const template = db.get('SELECT item_id AS id, item_name AS name FROM item WHERE item_id = ?', Number(body.item));
                if (template === null) {
                    throw new HttpError(422, 'Unknown item', { item: 'Please select an item' });
                }

                name = template.name;
                created = items.createInstance(db, {
                    item: template.id, quantity, ownerType: type, owner: owner.id, origin: 'moderation', originRef: 'moderator:' + user.account.id,
                    character: type === 'character' ? owner.id : null,
                });
            }

            action(user.account.id, owner.account ?? null, type === 'character' ? owner.id : null, 'item_give', {
                name, quantity: body.kind === 'equipment' ? 1 : quantity, uid: created.uid, owner: type + ' ' + owner.name, reason,
            });
        });

        live.nudge();

        return { ok: true, message: (body.kind === 'equipment' ? name : quantity + '× ' + name) + ' given to ' + owner.name, uid: created.uid };
    });

    router.post('/api/items/:id/remove', ({ params, body, user }) => {
        const item = items.instance(db, Number(params.id));
        if (item === null) {
            throw new HttpError(404, 'Item not found');
        }

        const reason = String(body.reason ?? '').trim().slice(0, 500);
        if (reason === '') {
            throw new HttpError(422, 'A reason is required', { reason: 'Please enter a reason (e.g. duplicated item)' });
        }

        let result = null;
        db.transaction(() => {
            result = items.remove(db, item.id, Number(body.quantity ?? item.quantity), user.account.id, reason);
            if (result === null) {
                throw new HttpError(409, 'The item was already removed');
            }

            const owner = ownerOr404(item.ownerType, item.owner);
            action(user.account.id, owner.account ?? null, item.ownerType === 'character' ? item.owner : null, 'item_remove', {
                name: item.name, quantity: result.removed, uid: item.uid, owner: item.ownerType + ' ' + owner.name, reason,
            });
        });

        return { ok: true, message: 'Removed ' + result.removed + '× ' + item.name + (result.remaining > 0 ? ' (' + result.remaining + ' left)' : '') };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // guilds
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/guilds/:id', ({ params }) => {
        const guild = db.get(
            `SELECT g.guild_id AS id, g.guild_name AS name, g.guild_tag AS tag, g.guild_description AS description, g.guild_created AS created,
                    g.guild_recruiting AS recruiting, s.server_name AS serverName
             FROM guild g LEFT JOIN server s ON s.server_id = g.guild_server WHERE g.guild_id = ?`,
            Number(params.id)
        );

        if (guild === null) {
            throw new HttpError(404, 'Guild not found');
        }

        const members = db.all(
            `SELECT c.character_id AS id, c.character_name AS name, c.character_account AS account, a.account_name AS accountName, a.account_status AS status,
                    c.character_xp AS xp, r.guild_role_name AS role, gr.guild_rank_name AS rank, m.guild_member_joined AS joined,
                    (SELECT COUNT(*) FROM mod_flag f WHERE f.mod_flag_account = c.character_account AND f.mod_flag_status = 'open') AS flags
             FROM guild_member m JOIN character c ON c.character_id = m.guild_member_character
             LEFT JOIN account a ON a.account_id = c.character_account
             LEFT JOIN guild_role r ON r.guild_role_id = m.guild_member_role
             LEFT JOIN guild_rank gr ON gr.guild_rank_id = m.guild_member_rank
             WHERE m.guild_member_guild = ? ORDER BY m.guild_member_role, c.character_name`,
            guild.id
        ).map((m) => ({ ...m, level: levelFromXp(db, m.xp ?? 0) }));

        return { guild, members };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // quests
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/quests/:character', ({ params }) => {
        const character = db.get('SELECT character_id AS id, character_name AS name, character_account AS account FROM character WHERE character_id = ?', Number(params.character));
        if (character === null) {
            throw new HttpError(404, 'Character not found');
        }

        return { character, quests: quests.forCharacter(db, character.id) };
    });

    router.post('/api/quests/:character', ({ params, body, user }) => {
        const character = db.get('SELECT character_id AS id, character_name AS name, character_account AS account FROM character WHERE character_id = ?', Number(params.character));
        if (character === null) {
            throw new HttpError(404, 'Character not found');
        }

        const reason = String(body.reason ?? '').trim().slice(0, 500);
        if (reason === '') {
            throw new HttpError(422, 'A reason is required', { reason: 'Please enter a reason (e.g. quest item lost after a disconnect)' });
        }

        const done = body.done !== false;
        const result = quests.update(db, { character: character.id, quest: Number(body.quest), step: body.step ? Number(body.step) : null, done, moderator: user.account.id });
        if (result === null) {
            throw new HttpError(404, 'Quest or step not found');
        }

        action(user.account.id, character.account, character.id, done ? 'quest_complete' : 'quest_reset', {
            name: result.quest.title + (result.step ? ': ' + result.step.title : ''), reason,
        });

        return { ok: true, message: (result.step ? 'Step "' + result.step.title + '"' : 'Quest "' + result.quest.title + '"') + (done ? ' completed' : ' reset') + ' for ' + character.name };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // player reports
    // -----------------------------------------------------------------------------------------------------------------

    /** reports filed/received by an account */
    const reportSummary = (account) => {
        const filed = db.get(
            `SELECT COUNT(*) AS total, SUM(player_report_status = 'action') AS actions, SUM(player_report_status = 'rejected') AS rejected,
                    SUM(player_report_status = 'open') AS open, COUNT(DISTINCT player_report_account) AS players
             FROM player_report WHERE player_report_reporter = ?`,
            account
        );
        const received = db.get(
            `SELECT COUNT(*) AS total, SUM(player_report_status = 'action') AS actions, SUM(player_report_status = 'rejected') AS rejected,
                    SUM(player_report_status = 'open') AS open, COUNT(DISTINCT player_report_reporter) AS players
             FROM player_report WHERE player_report_account = ?`,
            account
        );
        const norm = (r) => ({ total: r.total ?? 0, actions: r.actions ?? 0, rejected: r.rejected ?? 0, open: r.open ?? 0, players: r.players ?? 0,
            accuracy: (r.actions ?? 0) + (r.rejected ?? 0) > 0 ? (r.actions ?? 0) / ((r.actions ?? 0) + (r.rejected ?? 0)) : null });

        return { filed: norm(filed), received: norm(received) };
    };

    const reportRows = (where, params, limit) => db.all(
        `SELECT r.player_report_id AS id, r.player_report_created AS created, r.player_report_category AS category, r.player_report_text AS text,
                r.player_report_status AS status, r.player_report_note AS note, r.player_report_handled AS handled, m.account_name AS moderatorName,
                r.player_report_reporter AS reporter, ra.account_name AS reporterName, r.player_report_reporter_character AS reporterCharacter,
                rc.character_name AS reporterCharacterName, ra.account_report_blocked_until AS reporterBlockedUntil, ra.account_status AS reporterStatus,
                r.player_report_account AS account, ta.account_name AS accountName, r.player_report_character AS character, tc.character_name AS characterName,
                ta.account_status AS accountStatus, ta.account_muted_until AS accountMutedUntil,
                z.zone_name AS zoneName, s.server_name AS serverName,
                r.player_report_chat_message AS chatMessage, cm.chat_message_content AS chatText, cm.chat_message_time AS chatTime,
                (SELECT COUNT(*) FROM player_report x WHERE x.player_report_reporter = r.player_report_reporter) AS reporterTotal,
                (SELECT COUNT(*) FROM player_report x WHERE x.player_report_reporter = r.player_report_reporter AND x.player_report_status = 'action') AS reporterActions,
                (SELECT COUNT(*) FROM player_report x WHERE x.player_report_reporter = r.player_report_reporter AND x.player_report_status = 'rejected') AS reporterRejected,
                (SELECT COUNT(*) FROM player_report x WHERE x.player_report_account = r.player_report_account) AS targetTotal,
                (SELECT COUNT(DISTINCT x.player_report_reporter) FROM player_report x WHERE x.player_report_account = r.player_report_account) AS targetReporters,
                (SELECT COUNT(*) FROM player_report x WHERE x.player_report_account = r.player_report_account AND x.player_report_status = 'action') AS targetActions,
                (SELECT COUNT(*) FROM mod_flag f WHERE f.mod_flag_account = r.player_report_account AND f.mod_flag_status = 'open') AS targetFlags
         FROM player_report r
         LEFT JOIN account ra ON ra.account_id = r.player_report_reporter
         LEFT JOIN character rc ON rc.character_id = r.player_report_reporter_character
         LEFT JOIN account ta ON ta.account_id = r.player_report_account
         LEFT JOIN character tc ON tc.character_id = r.player_report_character
         LEFT JOIN account m ON m.account_id = r.player_report_moderator
         LEFT JOIN zone z ON z.zone_id = r.player_report_zone
         LEFT JOIN server s ON s.server_id = r.player_report_server
         LEFT JOIN chat_message cm ON cm.chat_message_id = r.player_report_chat_message
         WHERE ` + where + `
         ORDER BY r.player_report_status = 'open' DESC, r.player_report_created DESC LIMIT ?`,
        ...params, limit
    ).map((r) => ({ ...r, categoryName: REPORT_CATEGORIES[r.category] ?? r.category, statusName: REPORT_STATUS[r.status] ?? r.status }));

    router.get('/api/reports', ({ q }) => {
        const where = ['1 = 1'];
        const params = [];
        const status = q.str('status', 'open');

        if (status !== 'all') {
            where.push('r.player_report_status = ?');
            params.push(status);
        }

        if (q.str('category') !== '') {
            where.push('r.player_report_category = ?');
            params.push(q.str('category'));
        }

        if (q.int('reporter', null) !== null) {
            where.push('r.player_report_reporter = ?');
            params.push(q.int('reporter'));
        }

        if (q.int('account', null) !== null) {
            where.push('r.player_report_account = ?');
            params.push(q.int('account'));
        }

        return reportRows(where.join(' AND '), params, q.int('limit', 200, 1, 1000));
    });

    router.post('/api/reports/:id', ({ params, body, user }) => {
        const report = db.get('SELECT player_report_id AS id, player_report_account AS account, player_report_character AS character, player_report_reporter AS reporter FROM player_report WHERE player_report_id = ?', Number(params.id));
        if (report === null) {
            throw new HttpError(404, 'Report not found');
        }

        if (!Object.keys(REPORT_STATUS).includes(body.status)) {
            throw new HttpError(422, 'Invalid status');
        }

        const note = String(body.note ?? '').trim().slice(0, 1000);
        db.run(
            'UPDATE player_report SET player_report_status = ?, player_report_moderator = ?, player_report_handled = ?, player_report_note = ? WHERE player_report_id = ?',
            body.status, body.status === 'open' ? null : user.account.id, body.status === 'open' ? null : now(), note || null, report.id
        );
        action(user.account.id, report.account, report.character, 'report_' + body.status, { report: report.id, reporter: report.reporter, note });
        live.nudge();

        return { ok: true, message: 'Report #' + report.id + ': ' + REPORT_STATUS[body.status] };
    });

    router.get('/api/reporters', ({ q }) => {
        const since = now() - q.int('days', 90, 1, 3650) * 86400;
        const th = rules.thresholds(db);

        return {
            limits: { minResolved: th.report_min_resolved, falseRatio: th.report_false_ratio },
            rows: db.all(
                `SELECT r.player_report_reporter AS account, a.account_name AS name, a.account_status AS status, a.account_report_blocked_until AS blockedUntil,
                        COUNT(*) AS total, SUM(r.player_report_status = 'action') AS actions, SUM(r.player_report_status = 'rejected') AS rejected,
                        SUM(r.player_report_status = 'open') AS open, SUM(r.player_report_status = 'duplicate') AS duplicates,
                        COUNT(DISTINCT r.player_report_account) AS players, MAX(r.player_report_created) AS last,
                        SUM(r.player_report_created >= ?) AS lastDay,
                        (SELECT MAX(cnt) FROM (SELECT COUNT(*) AS cnt FROM player_report x WHERE x.player_report_reporter = r.player_report_reporter GROUP BY x.player_report_account)) AS maxSameTarget
                 FROM player_report r LEFT JOIN account a ON a.account_id = r.player_report_reporter
                 WHERE r.player_report_created >= ?
                 GROUP BY r.player_report_reporter`,
                now() - 86400, since
            ).map((r) => ({ ...r, accuracy: r.actions + r.rejected > 0 ? r.actions / (r.actions + r.rejected) : null, blocked: (r.blockedUntil ?? 0) > now() })),
        };
    });

    // -----------------------------------------------------------------------------------------------------------------
    // dungeons, raids, world bosses, PvP matches
    // -----------------------------------------------------------------------------------------------------------------

    router.get('/api/encounters', ({ q }) => {
        const where = ['1 = 1'];
        const args = [];

        if (q.str('type') !== '') {
            where.push('e.encounter_type = ?');
            args.push(q.str('type'));
        }

        if (q.int('instance', null) !== null) {
            where.push('e.encounter_instance = ?');
            args.push(q.int('instance'));
        }

        if (q.str('before') !== '') {
            where.push('e.encounter_start < ?');
            args.push(q.str('before'));
        }

        if (q.str('from') !== '') {
            where.push('e.encounter_start >= ?');
            args.push(q.str('from'));
        }

        if (q.str('to') !== '') {
            where.push('e.encounter_start < ?');
            args.push(q.str('to') + ' 99');
        }

        const player = q.str('player');
        if (player !== '') {
            where.push(`EXISTS (SELECT 1 FROM encounter_member em JOIN character c ON c.character_id = em.encounter_member_character
                LEFT JOIN account a ON a.account_id = c.character_account
                WHERE em.encounter_member_encounter = e.encounter_id AND (c.character_name LIKE ? OR a.account_name LIKE ?))`);
            args.push('%' + player + '%', '%' + player + '%');
        }

        if (q.int('account', null) !== null) {
            where.push('EXISTS (SELECT 1 FROM encounter_member em JOIN character c ON c.character_id = em.encounter_member_character WHERE em.encounter_member_encounter = e.encounter_id AND c.character_account = ?)');
            args.push(q.int('account'));
        }

        if (q.str('short') === '1') {
            where.push("e.encounter_type = 'pvp' AND e.encounter_duration < ?");
            args.push(rules.thresholds(db).short_match_seconds);
        }

        return db.all(
            `SELECT e.encounter_id AS id, e.encounter_type AS type, e.encounter_difficulty AS difficulty, e.encounter_start AS start,
                    e.encounter_duration AS duration, e.encounter_success AS success, e.encounter_winner AS winner, e.encounter_score1 AS score1,
                    e.encounter_score2 AS score2, i.instance_id AS instance, i.instance_name AS instanceName, i.instance_size AS size, pm.pvp_mode_name AS mode,
                    (SELECT COUNT(*) FROM encounter_member m WHERE m.encounter_member_encounter = e.encounter_id) AS members,
                    (SELECT COUNT(*) FROM chat_message c WHERE c.chat_message_encounter = e.encounter_id) AS chat,
                    (SELECT COUNT(*) FROM log_item_transaction l WHERE l.log_item_transaction_encounter = e.encounter_id AND l.log_item_transaction_sign = 1) AS drops,
                    (SELECT COUNT(*) FROM encounter_boss b WHERE b.encounter_boss_encounter = e.encounter_id) AS bosses,
                    (SELECT COUNT(*) FROM encounter_boss b WHERE b.encounter_boss_encounter = e.encounter_id AND b.encounter_boss_killed = 1) AS bossesKilled,
                    (SELECT COUNT(DISTINCT c.character_account) FROM encounter_member m JOIN character c ON c.character_id = m.encounter_member_character
                        JOIN mod_flag f ON f.mod_flag_account = c.character_account AND f.mod_flag_status = 'open'
                     WHERE m.encounter_member_encounter = e.encounter_id) AS flagged,
                    (SELECT MAX(m.encounter_member_apm) FROM encounter_member m WHERE m.encounter_member_encounter = e.encounter_id) AS maxApm
             FROM encounter e
             LEFT JOIN instance i ON i.instance_id = e.encounter_instance
             LEFT JOIN pvp_mode pm ON pm.pvp_mode_id = i.instance_pvp_mode
             WHERE ` + where.join(' AND ') + `
             ORDER BY e.encounter_start DESC, e.encounter_id DESC LIMIT ?`,
            ...args, q.int('limit', 200, 1, 1000)
        );
    });

    router.get('/api/encounters/:id', ({ params }) => {
        const e = db.get(
            `SELECT e.encounter_id AS id, e.encounter_type AS type, e.encounter_difficulty AS difficulty, e.encounter_start AS start,
                    e.encounter_duration AS duration, e.encounter_success AS success, e.encounter_winner AS winner, e.encounter_score1 AS score1,
                    e.encounter_score2 AS score2, i.instance_id AS instance, i.instance_name AS instanceName, i.instance_size AS size,
                    pm.pvp_mode_name AS mode, pm.pvp_mode_target AS target, pm.pvp_mode_unit AS unit
             FROM encounter e LEFT JOIN instance i ON i.instance_id = e.encounter_instance LEFT JOIN pvp_mode pm ON pm.pvp_mode_id = i.instance_pvp_mode
             WHERE e.encounter_id = ?`,
            Number(params.id)
        );

        if (e === null) {
            throw new HttpError(404, 'Encounter not found');
        }

        const th = rules.thresholds(db);
        const members = db.all(
            `SELECT m.encounter_member_id AS member, m.encounter_member_character AS character, c.character_name AS name, c.character_account AS account,
                    a.account_name AS accountName, a.account_status AS status, cl.class_name AS className, c.character_xp AS xp,
                    m.encounter_member_team AS team, m.encounter_member_role AS role, m.encounter_member_damage AS damage, m.encounter_member_healing AS healing,
                    m.encounter_member_damage_taken AS damageTaken, m.encounter_member_deaths AS deaths, m.encounter_member_kills AS kills,
                    m.encounter_member_assists AS assists, m.encounter_member_objectives AS objectives, m.encounter_member_apm AS apm,
                    m.encounter_member_active AS active, m.encounter_member_rating_before AS rating, m.encounter_member_rating_change AS ratingChange,
                    (SELECT COUNT(*) FROM mod_flag f WHERE f.mod_flag_account = c.character_account AND f.mod_flag_status = 'open') AS flags
             FROM encounter_member m
             LEFT JOIN character c ON c.character_id = m.encounter_member_character
             LEFT JOIN account a ON a.account_id = c.character_account
             LEFT JOIN class cl ON cl.class_id = c.character_class
             WHERE m.encounter_member_encounter = ? ORDER BY m.encounter_member_team, m.encounter_member_damage DESC`,
            e.id
        ).map((m) => ({ ...m, level: levelFromXp(db, m.xp ?? 0), dps: e.duration > 0 ? m.damage / e.duration : 0, hps: e.duration > 0 ? m.healing / e.duration : 0 }));

        const bosses = db.all(
            `SELECT b.encounter_boss_id AS id, ib.instance_boss_name AS name, ib.instance_boss_order AS position, b.encounter_boss_killed AS killed
             FROM encounter_boss b LEFT JOIN instance_boss ib ON ib.instance_boss_id = b.encounter_boss_boss
             WHERE b.encounter_boss_encounter = ? ORDER BY ib.instance_boss_order, b.encounter_boss_id`,
            e.id
        ).map((b) => ({
            ...b,
            attempts: db.all(
                'SELECT encounter_attempt_no AS no, encounter_attempt_duration AS duration, encounter_attempt_hp_left AS hpLeft, encounter_attempt_kill AS kill FROM encounter_attempt WHERE encounter_attempt_boss = ? ORDER BY encounter_attempt_no',
                b.id
            ),
        }));

        const scores = db.all(
            'SELECT encounter_score_time AS time, encounter_score_score1 AS score1, encounter_score_score2 AS score2 FROM encounter_score WHERE encounter_score_encounter = ? ORDER BY encounter_score_time',
            e.id
        );

        const start = parseSqlDate(e.start);
        const events = db.all(
            `SELECT ev.character_event_id AS id, ev.character_event_type AS type, ev.character_event_title AS title, ev.character_event_detail AS detail,
                    ev.character_event_rarity AS rarity, ev.character_event_datetime AS time, ev.character_event_character AS character, c.character_name AS characterName
             FROM character_event ev LEFT JOIN character c ON c.character_id = ev.character_event_character
             WHERE ev.character_event_encounter = ? ORDER BY ev.character_event_datetime`,
            e.id
        );

        // flags of the participants that are about this encounter (apm, short matches, streaks)
        const accounts = [...new Set(members.map((m) => m.account).filter(Boolean))];
        const flags = accounts.length === 0 ? [] : withNames(flagRows(
            'f.mod_flag_account IN (' + accounts.map(() => '?').join(',') + ") AND f.mod_flag_rule IN ('apm', 'short_matches', 'streak', 'chat_toxic', 'input_script') ORDER BY f.mod_flag_last_seen DESC",
            ...accounts
        )).filter((f) => {
            const d = f.detail ?? {};

            return (d.encounters ?? []).includes(e.id) || (d.matches ?? []).some((x) => x.id === e.id)
                || (f.rule === 'streak' && d.from <= e.id && d.to >= e.id && members.some((m) => m.character === f.character))
                || (f.rule === 'chat_toxic' && (d.messages ?? []).some((x) => x.time >= start && x.time <= start + e.duration));
        });

        return {
            encounter: { ...e, startTime: start, short: e.type === 'pvp' && e.duration < th.short_match_seconds },
            members,
            bosses,
            scores,
            events,
            flags,
            chat: feeds.chat(db, { encounter: e.id }, 1000).reverse(),
            drops: feeds.drops(db, { encounter: e.id }, 1000).sort((a, b) => a.time - b.time),
            limits: { maxApm: th.apm_max },
        };
    });

    router.get('/api/actions', ({ q }) => actions({ account: q.int('account', null), limit: q.int('limit', 100, 1, 500) }));

    // -----------------------------------------------------------------------------------------------------------------
    // automatic detection
    // -----------------------------------------------------------------------------------------------------------------

    let lastDetection = null;
    let timer = null;

    /** temporary bans that are over: the account is active again (logged as an action of the system) */
    const liftExpiredBans = () => {
        const t = now();
        for (const a of db.all('SELECT account_id AS id FROM account WHERE account_status = 2 AND account_banned_until IS NOT NULL AND account_banned_until <= ?', t)) {
            db.run('UPDATE account SET account_status = 1, account_banned_until = NULL WHERE account_id = ?', a.id);
            action(null, a.id, null, 'unban', { reason: 'Temporary ban expired' });
        }
    };

    const runDetection = () => {
        liftExpiredBans();
        const result = detect(db);
        lastDetection = { time: now(), ...result, created: result.created.length };

        return result;
    };

    const scheduleDetection = () => {
        clearTimeout(timer);
        const loop = () => {
            try {
                runDetection();
                live.nudge();
            } catch (error) {
                console.error('Detection failed:', error);
            }

            timer = setTimeout(loop, Math.max(10, rules.thresholds(db).detection_interval_seconds) * 1000);
            timer.unref();
        };

        timer = setTimeout(loop, 500);
        timer.unref();
    };

    return { scheduleDetection, stop: () => clearTimeout(timer) };
}

module.exports = { register, parseSqlDate };
