/**
 * Live updates (Server-Sent Events)
 *
 * The game server and the website write into the database, so the database is polled (once per second, only
 * while somebody is connected) for new rows. New rows are sent to the browsers that subscribed to the channel.
 */
'use strict';

const feeds = require('./feeds');
const { now } = require('./util');

const CHANNELS = ['chat', 'drops', 'trades', 'flags', 'support', 'status'];

class Live
{
    /**
     * @param {import('./db').Database} db
     */
    constructor (db)
    {
        this.db      = db;
        this.clients = new Set();
        this.timer   = null;
        this.cursor  = null;
        this.tick    = 0;
    }

    initCursor ()
    {
        const db = this.db;
        this.cursor = {
            chat: db.value('SELECT COALESCE(MAX(chat_message_id), 0) FROM chat_message'),
            gold: db.value('SELECT COALESCE(MAX(log_gold_transaction_id), 0) FROM log_gold_transaction'),
            item: db.value('SELECT COALESCE(MAX(log_item_transaction_id), 0) FROM log_item_transaction'),
            trade: db.value('SELECT COALESCE(MAX(trade_transaction_updated), 0) FROM trade_transaction'),
            flag: db.value('SELECT COALESCE(MAX(mod_flag_id), 0) FROM mod_flag'),
            support: db.value('SELECT COALESCE(MAX(mod_support_message_id), 0) FROM mod_support_message'),
        };
    }

    /**
     * Register a browser connection
     */
    connect (req, res, channels)
    {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('retry: 3000\n\n');

        const client = { res, channels: new Set(channels.filter((c) => CHANNELS.includes(c))) };
        client.channels.add('status');
        this.clients.add(client);

        this.send(client, 'status', this.status());

        res.on('close', () => {
            this.clients.delete(client);
            if (this.clients.size === 0) {
                this.stop();
            }
        });

        this.start();
    }

    start ()
    {
        if (this.timer !== null) {
            return;
        }

        this.initCursor();
        this.timer = setInterval(() => {
            try {
                this.poll();
            } catch (error) {
                console.error('Live update failed:', error.message);
            }
        }, 1000);
    }

    stop ()
    {
        clearInterval(this.timer);
        this.timer = null;
    }

    send (client, event, data)
    {
        client.res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    }

    broadcast (event, data)
    {
        for (const client of this.clients) {
            if (client.channels.has(event)) {
                this.send(client, event, data);
            }
        }
    }

    wants (channel)
    {
        for (const client of this.clients) {
            if (client.channels.has(channel)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Counters for the navigation (open flags, unread support messages, online players)
     */
    status ()
    {
        const db = this.db;
        const t  = now();

        return {
            time: t,
            flags: db.value("SELECT COUNT(*) FROM mod_flag WHERE mod_flag_status = 'open'"),
            highFlags: db.value("SELECT COUNT(*) FROM mod_flag WHERE mod_flag_status = 'open' AND mod_flag_severity >= 3"),
            unread: db.value('SELECT COUNT(*) FROM mod_support_message WHERE mod_support_message_direction = 1 AND mod_support_message_read = 0'),
            online: db.value('SELECT COUNT(DISTINCT log_play_time_character) FROM log_play_time WHERE log_play_time_end IS NULL AND log_play_time_start > ?', t - 86400),
            openTrades: db.value('SELECT COUNT(*) FROM trade_transaction WHERE trade_transaction_state = 0'),
            openReports: db.value("SELECT COUNT(*) FROM player_report WHERE player_report_status = 'open'"),
        };
    }

    poll ()
    {
        const c = this.cursor;
        const db = this.db;

        if (this.wants('chat')) {
            const rows = feeds.chat(db, { after: c.chat }, 200);
            if (rows.length > 0) {
                c.chat = Math.max(...rows.map((r) => r.id));
                this.broadcast('chat', rows);
            }
        } else {
            c.chat = db.value('SELECT COALESCE(MAX(chat_message_id), 0) FROM chat_message');
        }

        if (this.wants('drops')) {
            const gold = feeds.drops(db, { afterGold: c.gold, type: 'gold' }, 200);
            const item = feeds.drops(db, { afterItem: c.item, type: 'item' }, 200);
            if (gold.length > 0) {
                c.gold = Math.max(...gold.map((r) => r.id));
            }

            if (item.length > 0) {
                c.item = Math.max(...item.map((r) => r.id));
            }

            const rows = [...gold, ...item].sort((a, b) => a.time - b.time);
            if (rows.length > 0) {
                this.broadcast('drops', rows);
            }
        } else {
            c.gold = db.value('SELECT COALESCE(MAX(log_gold_transaction_id), 0) FROM log_gold_transaction');
            c.item = db.value('SELECT COALESCE(MAX(log_item_transaction_id), 0) FROM log_item_transaction');
        }

        const tradeCursor = db.value('SELECT COALESCE(MAX(trade_transaction_updated), 0) FROM trade_transaction');
        if (tradeCursor > c.trade) {
            if (this.wants('trades')) {
                this.broadcast('trades', feeds.trades(db, { updatedAfter: c.trade }, 200));
            }

            c.trade = tradeCursor;
        }

        const flagCursor = db.value('SELECT COALESCE(MAX(mod_flag_id), 0) FROM mod_flag');
        if (flagCursor > c.flag) {
            this.broadcast('flags', { created: flagCursor - c.flag });
            c.flag = flagCursor;
        }

        const supportCursor = db.value('SELECT COALESCE(MAX(mod_support_message_id), 0) FROM mod_support_message');
        if (supportCursor > c.support) {
            const rows = db.all(
                `SELECT m.mod_support_message_id AS id, m.mod_support_message_account AS account, m.mod_support_message_direction AS direction,
                        m.mod_support_message_content AS text, m.mod_support_message_time AS time, m.mod_support_message_moderator AS moderator,
                        mo.account_name AS moderatorName, a.account_name AS accountName, c.character_name AS characterName,
                        m.mod_support_message_delivered AS delivered
                 FROM mod_support_message m
                 LEFT JOIN account a ON a.account_id = m.mod_support_message_account
                 LEFT JOIN account mo ON mo.account_id = m.mod_support_message_moderator
                 LEFT JOIN character c ON c.character_id = m.mod_support_message_character
                 WHERE m.mod_support_message_id > ? ORDER BY m.mod_support_message_id`,
                c.support
            );
            c.support = supportCursor;
            this.broadcast('support', rows);
        }

        // messages of the team that the game delivered in the meantime
        const waiting = db.all('SELECT mod_support_message_id AS id, mod_support_message_account AS account FROM mod_support_message WHERE mod_support_message_direction = 0 AND mod_support_message_delivered = 0');
        const waitingIds = new Set(waiting.map((w) => w.id));
        const delivered = [...(this.waiting ?? new Map())].filter(([id]) => !waitingIds.has(id)).map(([, account]) => ({ account, delivered: true }));
        this.waiting = new Map(waiting.map((w) => [w.id, w.account]));
        if (delivered.length > 0) {
            this.broadcast('support', delivered);
        }

        if (++this.tick % 5 === 0) {
            this.broadcast('status', this.status());
        }

        // keep the connections open through proxies
        if (this.tick % 20 === 0) {
            for (const client of this.clients) {
                client.res.write(': ping\n\n');
            }
        }
    }

    /**
     * Something changed (e.g. a moderator wrote a message), send the update right away
     */
    nudge ()
    {
        if (this.timer !== null) {
            try {
                this.poll();
                this.broadcast('status', this.status());
            } catch (error) {
                console.error('Live update failed:', error.message);
            }
        }
    }
}

module.exports = { Live };
