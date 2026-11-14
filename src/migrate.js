/**
 * Schema changes needed by the moderation tool
 *
 * Idempotent: can run any number of times, existing tables/columns are not changed.
 * The empty game log tables of TalesOfSouls.db (chat_message, log_gold_transaction, trade_transaction, ...)
 * are used as they are and only get the columns that are missing to answer "who, what, where and when".
 *
 * Times of the game log tables are unix timestamps (seconds), like the existing columns (chat_message_time, ...).
 */
'use strict';

const TABLES = {
    zone: `CREATE TABLE "zone" (
        "zone_id" INTEGER,
        "zone_name" TEXT,
        "zone_type" TEXT,
        "zone_level_min" INTEGER,
        "zone_level_max" INTEGER,
        PRIMARY KEY("zone_id" AUTOINCREMENT)
    )`,

    trade_transaction_item: `CREATE TABLE "trade_transaction_item" (
        "trade_transaction_item_id" INTEGER,
        "trade_transaction_item_trade" INTEGER,
        "trade_transaction_item_side" INTEGER,
        "trade_transaction_item_item" INTEGER,
        "trade_transaction_item_individual" INTEGER,
        "trade_transaction_item_quantity" INTEGER DEFAULT 1,
        PRIMARY KEY("trade_transaction_item_id" AUTOINCREMENT),
        FOREIGN KEY("trade_transaction_item_trade") REFERENCES "trade_transaction"("trade_transaction_id"),
        FOREIGN KEY("trade_transaction_item_item") REFERENCES "item"("item_id"),
        FOREIGN KEY("trade_transaction_item_individual") REFERENCES "item_individual"("item_individual_id")
    )`,

    log_skill_input: `CREATE TABLE "log_skill_input" (
        "log_skill_input_id" INTEGER,
        "log_skill_input_character" INTEGER,
        "log_skill_input_skill" INTEGER,
        "log_skill_input_time" INTEGER,
        "log_skill_input_encounter" INTEGER,
        PRIMARY KEY("log_skill_input_id" AUTOINCREMENT),
        FOREIGN KEY("log_skill_input_character") REFERENCES "character"("character_id"),
        FOREIGN KEY("log_skill_input_skill") REFERENCES "skill"("skill_id")
    )`,

    item_instance: `CREATE TABLE "item_instance" (
        "item_instance_id" INTEGER,
        "item_instance_uid" TEXT,
        "item_instance_item" INTEGER,
        "item_instance_individual" INTEGER,
        "item_instance_quantity" INTEGER DEFAULT 1,
        "item_instance_owner_type" TEXT,
        "item_instance_owner" INTEGER,
        "item_instance_container" TEXT,
        "item_instance_slot" INTEGER,
        "item_instance_created" INTEGER,
        "item_instance_origin" TEXT,
        "item_instance_origin_ref" TEXT,
        "item_instance_deleted" INTEGER,
        "item_instance_deleted_by" INTEGER,
        "item_instance_deleted_reason" TEXT,
        PRIMARY KEY("item_instance_id" AUTOINCREMENT),
        FOREIGN KEY("item_instance_item") REFERENCES "item"("item_id"),
        FOREIGN KEY("item_instance_individual") REFERENCES "item_individual"("item_individual_id")
    )`,

    character_quest_step: `CREATE TABLE "character_quest_step" (
        "character_quest_step_id" INTEGER,
        "character_quest_step_quest" INTEGER,
        "character_quest_step_state" INTEGER,
        "character_quest_step_progress" INTEGER DEFAULT 0,
        "character_quest_step_completed" INTEGER,
        "character_quest_step_moderator" INTEGER,
        PRIMARY KEY("character_quest_step_id" AUTOINCREMENT),
        FOREIGN KEY("character_quest_step_quest") REFERENCES "character_quest"("character_quest_id"),
        FOREIGN KEY("character_quest_step_state") REFERENCES "quest_state"("quest_state_id")
    )`,

    player_report: `CREATE TABLE "player_report" (
        "player_report_id" INTEGER,
        "player_report_reporter" INTEGER,
        "player_report_reporter_character" INTEGER,
        "player_report_account" INTEGER,
        "player_report_character" INTEGER,
        "player_report_category" TEXT,
        "player_report_text" TEXT,
        "player_report_chat_message" INTEGER,
        "player_report_zone" INTEGER,
        "player_report_server" INTEGER,
        "player_report_created" INTEGER,
        "player_report_status" TEXT DEFAULT 'open',
        "player_report_moderator" INTEGER,
        "player_report_handled" INTEGER,
        "player_report_note" TEXT,
        PRIMARY KEY("player_report_id" AUTOINCREMENT),
        FOREIGN KEY("player_report_reporter") REFERENCES "account"("account_id"),
        FOREIGN KEY("player_report_account") REFERENCES "account"("account_id")
    )`,

    mod_threshold: `CREATE TABLE "mod_threshold" (
        "mod_threshold_key" TEXT,
        "mod_threshold_value" REAL,
        "mod_threshold_updated" INTEGER,
        "mod_threshold_updated_by" INTEGER,
        PRIMARY KEY("mod_threshold_key")
    )`,

    mod_flag: `CREATE TABLE "mod_flag" (
        "mod_flag_id" INTEGER,
        "mod_flag_rule" TEXT,
        "mod_flag_account" INTEGER,
        "mod_flag_character" INTEGER,
        "mod_flag_ref" TEXT,
        "mod_flag_severity" INTEGER,
        "mod_flag_value" REAL,
        "mod_flag_threshold" REAL,
        "mod_flag_detail" TEXT,
        "mod_flag_first_seen" INTEGER,
        "mod_flag_last_seen" INTEGER,
        "mod_flag_hits" INTEGER DEFAULT 1,
        "mod_flag_status" TEXT DEFAULT 'open',
        "mod_flag_reviewer" INTEGER,
        "mod_flag_reviewed" INTEGER,
        "mod_flag_note" TEXT,
        PRIMARY KEY("mod_flag_id" AUTOINCREMENT),
        FOREIGN KEY("mod_flag_account") REFERENCES "account"("account_id")
    )`,

    mod_support_message: `CREATE TABLE "mod_support_message" (
        "mod_support_message_id" INTEGER,
        "mod_support_message_account" INTEGER,
        "mod_support_message_character" INTEGER,
        "mod_support_message_moderator" INTEGER,
        "mod_support_message_direction" INTEGER,
        "mod_support_message_content" TEXT,
        "mod_support_message_time" INTEGER,
        "mod_support_message_read" INTEGER DEFAULT 0,
        "mod_support_message_delivered" INTEGER DEFAULT 0,
        PRIMARY KEY("mod_support_message_id" AUTOINCREMENT),
        FOREIGN KEY("mod_support_message_account") REFERENCES "account"("account_id")
    )`,

    mod_action: `CREATE TABLE "mod_action" (
        "mod_action_id" INTEGER,
        "mod_action_moderator" INTEGER,
        "mod_action_account" INTEGER,
        "mod_action_character" INTEGER,
        "mod_action_type" TEXT,
        "mod_action_detail" TEXT,
        "mod_action_time" INTEGER,
        PRIMARY KEY("mod_action_id" AUTOINCREMENT)
    )`,

    mod_session: `CREATE TABLE "mod_session" (
        "mod_session_token" TEXT,
        "mod_session_account" INTEGER,
        "mod_session_csrf" TEXT,
        "mod_session_created" INTEGER,
        "mod_session_expires" INTEGER,
        PRIMARY KEY("mod_session_token")
    )`,
};

/**
 * Columns added to existing tables
 */
const COLUMNS = {
    account: {
        account_muted_until: 'INTEGER',
        account_report_blocked_until: 'INTEGER',
        account_banned_until: 'INTEGER',
    },
    chat_message: {
        chat_message_encounter: 'INTEGER',
    },
    quest_state: {
        quest_state_quest: 'INTEGER',
        quest_state_order: 'INTEGER',
        quest_state_target: 'INTEGER DEFAULT 1',
    },
    character_quest: {
        character_quest_status: 'INTEGER DEFAULT 0',
        character_quest_started: 'INTEGER',
        character_quest_completed: 'INTEGER',
    },
    trade_transaction_item: {
        trade_transaction_item_uid: 'TEXT',
    },
    log_gold_transaction: {
        log_gold_transaction_character: 'INTEGER',
        log_gold_transaction_amount: 'INTEGER',
        log_gold_transaction_source: 'TEXT',
        log_gold_transaction_server: 'INTEGER',
        log_gold_transaction_encounter: 'INTEGER',
    },
    log_item_transaction: {
        log_item_transaction_character: 'INTEGER',
        log_item_transaction_item: 'INTEGER',
        log_item_transaction_individual: 'INTEGER',
        log_item_transaction_quantity: 'INTEGER DEFAULT 1',
        log_item_transaction_rarity: 'INTEGER',
        log_item_transaction_source: 'TEXT',
        log_item_transaction_origin_mob: 'INTEGER',
        log_item_transaction_server: 'INTEGER',
        log_item_transaction_uid: 'TEXT',
        log_item_transaction_encounter: 'INTEGER',
    },
    trade_transaction: {
        trade_transaction_character1: 'INTEGER',
        trade_transaction_character2: 'INTEGER',
        trade_transaction_gold1: 'INTEGER DEFAULT 0',
        trade_transaction_gold2: 'INTEGER DEFAULT 0',
        trade_transaction_state: 'INTEGER DEFAULT 0',
        trade_transaction_created: 'INTEGER',
        trade_transaction_updated: 'INTEGER',
        trade_transaction_server: 'INTEGER',
        trade_transaction_area: 'INTEGER',
    },
    log_play_time: {
        log_play_time_xp: 'INTEGER DEFAULT 0',
        log_play_time_server: 'INTEGER',
    },
    log_snapshot: {
        log_snapshot_time: 'INTEGER',
        log_snapshot_session: 'INTEGER',
    },
    auction: {
        auction_end: 'INTEGER',
        auction_server: 'INTEGER',
        auction_item_uid: 'TEXT',
    },
};

const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_chat_message_time ON chat_message (chat_message_time)',
    'CREATE INDEX IF NOT EXISTS idx_chat_message_character ON chat_message (chat_message_character)',
    'CREATE INDEX IF NOT EXISTS idx_log_gold_character ON log_gold_transaction (log_gold_transaction_character, log_gold_transaction_time)',
    'CREATE INDEX IF NOT EXISTS idx_log_gold_time ON log_gold_transaction (log_gold_transaction_time)',
    'CREATE INDEX IF NOT EXISTS idx_log_item_character ON log_item_transaction (log_item_transaction_character, log_item_transaction_time)',
    'CREATE INDEX IF NOT EXISTS idx_log_item_time ON log_item_transaction (log_item_transaction_time)',
    'CREATE INDEX IF NOT EXISTS idx_trade_updated ON trade_transaction (trade_transaction_updated)',
    'CREATE INDEX IF NOT EXISTS idx_trade_item_trade ON trade_transaction_item (trade_transaction_item_trade)',
    'CREATE INDEX IF NOT EXISTS idx_play_time_character ON log_play_time (log_play_time_character, log_play_time_start)',
    'CREATE INDEX IF NOT EXISTS idx_snapshot_session ON log_snapshot (log_snapshot_session, log_snapshot_time)',
    'CREATE INDEX IF NOT EXISTS idx_snapshot_character ON log_snapshot (log_snapshot_character, log_snapshot_time)',
    'CREATE INDEX IF NOT EXISTS idx_skill_input_character ON log_skill_input (log_skill_input_character, log_skill_input_time)',
    'CREATE INDEX IF NOT EXISTS idx_auth_account ON log_auth (log_auth_account, log_auth_time)',
    'CREATE INDEX IF NOT EXISTS idx_auction_item ON auction (auction_item, auction_start)',
    'CREATE INDEX IF NOT EXISTS idx_auction_tx_auction ON auction_transaction (auction_transaction_auction)',
    'CREATE INDEX IF NOT EXISTS idx_log_message_ref ON log_message (log_message_ref)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_flag_key ON mod_flag (mod_flag_rule, mod_flag_account, mod_flag_ref)',
    'CREATE INDEX IF NOT EXISTS idx_mod_flag_status ON mod_flag (mod_flag_status, mod_flag_last_seen)',
    'CREATE INDEX IF NOT EXISTS idx_mod_support_account ON mod_support_message (mod_support_message_account, mod_support_message_time)',
    'CREATE INDEX IF NOT EXISTS idx_mod_action_account ON mod_action (mod_action_account, mod_action_time)',
    'CREATE INDEX IF NOT EXISTS idx_encounter_member_character ON encounter_member (encounter_member_character)',
    'CREATE INDEX IF NOT EXISTS idx_character_account ON character (character_account)',
    'CREATE INDEX IF NOT EXISTS idx_item_instance_uid ON item_instance (item_instance_uid)',
    'CREATE INDEX IF NOT EXISTS idx_chat_message_encounter ON chat_message (chat_message_encounter)',
    'CREATE INDEX IF NOT EXISTS idx_log_gold_encounter ON log_gold_transaction (log_gold_transaction_encounter)',
    'CREATE INDEX IF NOT EXISTS idx_log_item_encounter ON log_item_transaction (log_item_transaction_encounter)',
    'CREATE INDEX IF NOT EXISTS idx_encounter_start ON encounter (encounter_start)',
    'CREATE INDEX IF NOT EXISTS idx_encounter_member_encounter ON encounter_member (encounter_member_encounter)',
    'CREATE INDEX IF NOT EXISTS idx_encounter_boss_encounter ON encounter_boss (encounter_boss_encounter)',
    'CREATE INDEX IF NOT EXISTS idx_encounter_attempt_boss ON encounter_attempt (encounter_attempt_boss)',
    'CREATE INDEX IF NOT EXISTS idx_encounter_score_encounter ON encounter_score (encounter_score_encounter)',
    'CREATE INDEX IF NOT EXISTS idx_item_instance_owner ON item_instance (item_instance_owner_type, item_instance_owner)',
    'CREATE INDEX IF NOT EXISTS idx_log_item_uid ON log_item_transaction (log_item_transaction_uid)',
    'CREATE INDEX IF NOT EXISTS idx_character_quest_character ON character_quest (character_quest_character)',
    'CREATE INDEX IF NOT EXISTS idx_character_quest_step_quest ON character_quest_step (character_quest_step_quest)',
    'CREATE INDEX IF NOT EXISTS idx_quest_state_quest ON quest_state (quest_state_quest)',
    'CREATE INDEX IF NOT EXISTS idx_player_report_reporter ON player_report (player_report_reporter)',
    'CREATE INDEX IF NOT EXISTS idx_player_report_account ON player_report (player_report_account)',
    'CREATE INDEX IF NOT EXISTS idx_player_report_status ON player_report (player_report_status, player_report_created)',
];

const ZONES = [
    ['Highmere', 'town', 1, 60],
    ['Greenvale Meadows', 'field', 1, 12],
    ['Whispering Woods', 'field', 10, 22],
    ['Saltmarsh Coast', 'field', 18, 30],
    ['Ironpeak Mines', 'field', 26, 38],
    ['Dunes of Kesh', 'field', 34, 46],
    ['Frostfang Tundra', 'field', 42, 54],
    ['Ember Wastes', 'field', 50, 60],
    ['Port Calder', 'town', 1, 60],
    ['Sunken Crypt', 'dungeon', 15, 25],
    ['Arena of Valor', 'pvp', 10, 60],
    ['Ashen Halls', 'dungeon', 30, 40],
];

/**
 * Run the migration
 *
 * @param {import('./db').Database} db
 *
 * @return {string[]} Changes
 */
function migrate (db)
{
    const changes = [];

    db.transaction(() => {
        for (const [table, sql] of Object.entries(TABLES)) {
            if (!db.tableExists(table)) {
                db.exec(sql);
                changes.push('+ table ' + table);
            }
        }

        for (const [table, columns] of Object.entries(COLUMNS)) {
            if (!db.tableExists(table)) {
                continue;
            }

            const existing = db.columns(table);
            for (const [column, type] of Object.entries(columns)) {
                if (!existing.includes(column)) {
                    db.exec('ALTER TABLE "' + table + '" ADD COLUMN "' + column + '" ' + type);
                    changes.push('+ column ' + table + '.' + column);
                }
            }
        }

        for (const sql of INDEXES) {
            db.exec(sql);
        }

        if (db.value('SELECT COUNT(*) FROM zone') === 0) {
            for (const zone of ZONES) {
                db.run('INSERT INTO zone (zone_name, zone_type, zone_level_min, zone_level_max) VALUES (?, ?, ?, ?)', ...zone);
            }

            changes.push('+ zones');
        }
    });

    return changes;
}

module.exports = { migrate };

if (require.main === module) {
    const { db } = require('./db');
    const changes = migrate(db());
    console.log(changes.length === 0 ? 'Database is up to date' : changes.join('\n'));
}
