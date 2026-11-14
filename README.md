<<<<<<< HEAD
# Tales of Souls – Moderation

Internal tool for the team. Players never see it. It runs on Node.js (version 22.5 or newer) and has **no npm dependencies**: just
`node:http`, `node:sqlite` and `node:crypto`. Chart.js is the only third-party file, and it lives in `public/vendor`.

It uses the same database as the website (`../Website/TalesOfSouls.db`).

## Start

### With Docker (together with the website)

```
cd ../Docker
docker-compose up --watch
```

| Service | Address |
| --- | --- |
| Website | http://127.0.0.3 |
| Moderation | **http://127.0.0.7** |

Or only the moderation tool, from this folder (uses `Moderation/docker-compose.yml`, do not run both at the same time):

```
cd Moderation
docker compose up
```

The port is only published on `127.0.0.7`. That is a loopback address, so the tool can only be opened on the computer that runs Docker.
Other computers on the network and the internet cannot reach it.

### Without Docker

```
node server.js            # http://127.0.0.1:8090
node scripts/simulate.js  # optional, in a second terminal: live chat/drops/trades
```

The server only listens on `127.0.0.1` unless `HOST` is set.

| Variable | Default | |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8090` | Port |
| `TOS_DB` | `../Website/TalesOfSouls.db` | Database file |
| `SECURE_COOKIE` | – | `1` = session cookie only over https (behind a https proxy) |

## Sign in

Sign in with a website account that has the role **developer (1)** or **admin (2)** and the status *active*. Use the same password
as on the website. The dummy data contains:

| Account | Password | Role |
| --- | --- | --- |
| `admin` | `AdminPass2026!` | Administrator |
| `Morgwen` | `password` | Developer |

Player accounts (e.g. `tester`) cannot sign in.

Bans can be permanent or temporary (1 hour - 1 year or a custom number of days); temporary bans are lifted automatically and logged as an action of the system. Sessions last 12 hours. After 5 failed sign-ins, an IP is blocked for 5 minutes.

## Pages

| Page | |
| --- | --- |
| Dashboard | Online players, open flags, support requests, activity of the last 24 hours, most suspicious accounts |
| Suspicious activity | Flags found by the rules. Each flag can be confirmed or dismissed with a note, and a check can be started by hand |
| Rankings | Per account: gold/min, XP/min, playtime of the last 5 days, matches, win/loss, average/peak DPS, peak damage, average/peak healing, max APM. Values above a limit are red, statistical outliers are yellow |
| Live chat | All channels, live. Bad words are highlighted. Messages can be marked as ok/offensive, and the author can be muted. **Click a message** (here, in profiles, reports, flags and instances) to see the conversation before and after it: the same channel, the whisper conversation, the instance/match, the guild chat, all channels of the zone, or everything of that player |
| Instances & matches | Dungeons, raids, world boss fights and PvP matches, newest first, with filters (type, instance, player, dates, only suspiciously short matches). The detail page shows everything that happened: players with their statistics (teams for PvP), bosses and attempts or the score history, events, the chat and the loot/gold |
| Live drops | Gold and item drops, live: who got what, from which monster, where (zone + position) |
| Trades | Open and completed trades, live. Gold for nothing is marked |
| Players | Search and online list. The **player profile** shows statistics, characters, charts, flags, chat, drops, trades, auctions, logins and accounts with the same IP/hardware, achievements and notes. Actions: message, mute, ban, award/revoke achievement, note |
| Character profile | **Current location** (running instance/match, zone, position with a small map, server; refreshed every 15 seconds; last known location for offline characters), statistics, encounters, **routes** (a drawn map compared with other sessions) and **input analysis** (timing histogram, combo regularity) |
| Player support | Chat with players. Messages are stored in `mod_support_message`, and the game delivers them |
| Player reports | Reports sent by players: mark them as *action taken*, *no violation* or *duplicate*. The **Reporters** tab shows for every reporter how many reports he sent, how many players he reported, how often the same player, and how many reports resulted in an action. Reporting can be blocked for a time |
| Item trace | Every item has a unique item id. The trace shows all copies of an id (duplicates), its complete history and trades. Copies can be removed |
| Inventories | Player profile, character profile and guild page: backpacks, account stash and guild vault. Items can be **given** (an item, or a piece of equipment with type/name/rarity/level) and **removed** (also partly). A reason is required and logged |
| Quests | Player and character profile: mark a quest or a single step as completed, or reset it |
| Configuration | All limits, rules on/off, bad word list |
| Moderation log | Every action of the team |

## Detection rules

Every rule has its limits on the configuration page. The rules run automatically (every 60 seconds by default).

| Rule | Data |
| --- | --- |
| XP rate, gold rate | `log_play_time` (xp per session), `log_gold_transaction` (loot/quest/vendor) |
| Item drops | `log_item_transaction`, busiest 10 minutes |
| Playtime | `log_play_time`, average hours per day over the last 5 days |
| Offensive chat, spam | `chat_message` + `bad_word_dictionary`. Hits are stored in `log_message` |
| Repeated route | `log_snapshot` positions are snapped to a grid, and the routes of the sessions are compared (Jaccard similarity of the transitions) |
| Input script | `log_skill_input`: share of inputs faster than a human can press, and the timing regularity (coefficient of variation) of skill combos |
| APM | `encounter_member_apm` |
| Win/loss streak, short matches | `encounter` / `encounter_member` (PvP, last 7 days) |
| Auction price | `auction` price per unit compared with the median of the item. Seller and buyer are both flagged |
| One-sided trade | `trade_transaction` with a lot of gold for nothing |
| Shared hardware | `log_auth` hardware id used by several accounts |
| Duplicated item | `item_instance`: the same `item_instance_uid` exists more than once |
| Item without origin | `item_instance` without a `log_item_transaction` entry (with its uid) that says how it was obtained |
| Grown stack | stack quantity is higher than the quantity that was ever added to this uid (`log_item_transaction`) |
| False reports | `player_report`: a reporter with many handled reports, of which most had no violation |
| Report spam | many reports per day, or again and again against the same player |

## Data the game server has to write

The moderation tool only reads game data. It uses the existing (empty) log tables of the database and adds the columns they were
missing (`src/migrate.js`, which runs automatically when the server starts). All times are unix timestamps; skill inputs use milliseconds.

| Table | Written by the game |
| --- | --- |
| `chat_message` | every chat message (`chat_message_location` = zone) |
| `log_gold_transaction` | gold +/- with `_character`, `_amount`, `_source` (loot, quest, vendor, trade, auction, …), position, zone, mob |
| `log_item_transaction` | items +/- with `_character`, `_item` or `_individual`, `_quantity`, `_source`, position, zone, mob |
| `trade_transaction`, `trade_transaction_item` | trades (`_state` 0 = open, 1 = completed, 2 = cancelled, `_updated` on every change) |
| `log_play_time` | sessions (`_end` stays NULL while the player is online), `_xp` = xp earned in the session |
| `log_snapshot` | position every ~30 seconds (`_time`, `_session` = `log_play_time_id`). The newest one is the current location of a character |
| `encounter` | while a dungeon/raid/match is running, `encounter_start` + `encounter_duration` must be in the future (the game keeps the duration up to date). Such encounters are shown as the current instance of their members |
| `log_skill_input` | skill presses (`_time` in milliseconds) |
| `log_auth` | logins with IP and hardware id |
| `auction`, `auction_transaction` | auction house |
| `mod_support_message` | the game shows `direction = 0` messages to the player, sets `_delivered = 1`, and stores answers as `direction = 1` |
| `account.account_muted_until` | the game must not accept chat messages while it is in the future |
| `account.account_banned_until` | end of a temporary ban (`account_status` = 2). NULL = permanent. The moderation tool sets the account active again when the time is over |
| `chat_message.chat_message_encounter`, `log_gold_transaction_encounter`, `log_item_transaction_encounter` | the encounter (dungeon, raid, match) a message/drop belongs to |
| `account.account_report_blocked_until` | the game must not accept reports from the player while it is in the future |
| `item_instance` | every item in the world: unique `_uid` (UUID), template (`_item`) or equipment (`_individual`), `_quantity`, owner (`_owner_type` character/account/guild + `_owner`), `_container` (backpack/stash/vault). Removed items keep their row (`_deleted`). The game has to load the inventories from here, so items given/removed by the team take effect |
| `log_item_transaction._uid` | the uid of the item for every change, so the history of an item can be traced |
| `trade_transaction_item._uid` | the uid of a traded item |
| `quest_state`, `quest_state_l11n` | steps of a quest (`_quest`, `_order`, `_target`, title) |
| `character_quest`, `character_quest_step` | quest progress (`character_quest_status` 0 = active, 1 = completed). Steps completed by the team have `_moderator` set |
| `player_report` | reports of players (`_reporter`, `_account` = reported player, `_category`, `_text`, optional `_chat_message`). The tool sets `_status` (open, action, rejected, duplicate) |

New tables of the tool: `zone`, `log_skill_input`, `trade_transaction_item`, `item_instance`, `character_quest_step`, `player_report`,
`mod_threshold`, `mod_flag`, `mod_support_message`, `mod_action`, `mod_session`.

## Dummy data

```
node scripts/seed.js      # activity of the last 14 days, relative to now (replaces the previous run)
node scripts/simulate.js  # live activity while it runs (Ctrl+C to stop)
```

The seed creates the history for all dummy players. It also creates some suspicious accounts on purpose (the script prints them):

- a bot farm: 3 accounts on one computer, 21 hours a day on the same route, regular inputs, gold to a seller
- an XP exploiter
- a toxic player
- a gold seller who spams and trades gold
- two win traders
- a script user with very high APM
- two pairs that move gold/items through the auction house
- an item duper: two raid items that exist twice after a trade, a stack that grew from 20 to 250, and 4 items without origin
- a false reporter: 31 reports, mostly against the same player, nearly all unfounded

It also creates inventories for all characters, accounts and guilds, quest progress with steps, and about 230 player reports.
The player who asked the support about a lost lantern is stuck at "Recover the old lantern" in *The Ghost Paths*.

Because the data is relative to the time of the seed, run it again before a demo after a few days.
=======
# Moderation
>>>>>>> 062c28756aef74bc63b5511d643ce19c6bcec317
