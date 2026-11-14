import { html, $, $$, get, post, qs, num, dateTime, ago, duration, toast, errorToast, dialog, accountLink, characterLink, severityBadge, live } from '../core.js';
import { flagTable, bindFlagReview } from '../flagview.js';
import { kpis, activityPanels, activityCharts, chatTable, dropTable, tradeTable, tabs } from '../statsview.js';
import { navigate } from '../app.js';
import { renderInventory } from '../inventoryview.js';
import { renderQuests } from '../questview.js';
import { locationText } from '../locationview.js';
import { reportTable, bindReportReview } from '../reportview.js';

const TABS = [
    ['overview', 'Overview'], ['flags', 'Flags'], ['inventory', 'Inventory'], ['quests', 'Quests'], ['chat', 'Chat'], ['drops', 'Drops'], ['trades', 'Trades'],
    ['auctions', 'Auctions'], ['reports', 'Reports'], ['logins', 'Logins & related accounts'], ['achievements', 'Achievements'], ['log', 'Notes & actions'],
];

export async function render (view, params, query)
{
    const id = Number(params[0]);
    const days = parseInt(query.get('days') ?? '14', 10) || 14;
    let tab = location.hash.slice(1) || 'overview';
    let charts = [];
    let data = null;

    // own element: the listeners are removed with it when the page is left
    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    const load = async () => {
        data = await get('/api/players/' + id + '?days=' + days);
        draw();
    };

    const draw = () => {
        const a = data.account;
        const s = data.stats;
        const openFlags = data.flags.filter((f) => f.status === 'open');

        charts.forEach((c) => c?.destroy());
        charts = [];

        root.innerHTML = String(html`
            <div class="page">
                <div class="page-head">
                    <div class="profile-head">
                        <div class="avatar">${a.name.slice(0, 1).toUpperCase()}</div>
                        <div>
                            <h1>${a.name} <span class="muted small">#${a.id}</span></h1>
                            <div class="row" style="margin-top:4px">
                                ${data.online ? html`<span class="badge online">online</span>` : html`<span class="badge">offline</span>`}
                                <span class="badge ${a.status === 2 ? 'sev-3' : (a.status === 1 ? 'ok' : '')}" title="${a.status === 2 && a.bannedUntil ? 'until ' + dateTime(a.bannedUntil) : ''}">${a.statusName}${a.status === 2 ? (a.bannedUntil ? ' until ' + dateTime(a.bannedUntil) : ' permanently') : ''}</span>
                                ${a.muted ? html`<span class="badge sev-2" title="until ${dateTime(a.mutedUntil)}">muted ${ago(a.mutedUntil).replace('in ', 'for ')}</span>` : ''}
                                ${a.role > 0 ? html`<span class="badge">${a.roleName}</span>` : ''}
                                ${openFlags.length > 0 ? html`<a href="#flags" data-tab-link="flags">${severityBadge(Math.max(...openFlags.map((f) => f.severity)))} ${openFlags.length} open flag(s)</a>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="actions">
                        <a class="button" href="/support/${a.id}">Message${data.unread > 0 ? html` <span class="count alert">${data.unread}</span>` : ''}</a>
                        ${a.muted ? html`<button data-action="unmute">Unmute</button>` : html`<button data-action="mute">Mute</button>`}
                        ${a.status === 2 ? html`<button data-action="unban" class="success">Unban</button>` : html`<button data-action="ban" class="danger">Ban</button>`}
                        <button data-action="award">Award achievement</button>
                        <button data-action="note">Add note</button>
                    </div>
                </div>

                <div class="grid cols-3" style="margin-bottom:14px">
                    <div class="panel">
                        <h3>Account</h3>
                        <dl class="facts">
                            <dt>E-mail</dt><dd>${a.email ?? '-'}</dd>
                            <dt>Created</dt><dd>${dateTime(a.created)}</dd>
                            <dt>Last website login</dt><dd>${dateTime(a.lastLogin)}</dd>
                            <dt>Characters</dt><dd>${data.characters.length}</dd>
                            <dt>Achievements</dt><dd>${data.achievements.tiers} tiers in ${data.achievements.types} achievements</dd>
                        </dl>
                    </div>
                    <div class="panel span-2 flush">
                        <h2>Characters</h2>
                        <div class="table-wrap"><table>
                            <thead><tr><th>Character</th><th>Level</th><th>Class</th><th>Race</th><th>Server</th><th>Guild</th><th class="num">Playtime</th><th>Location / last session</th><th class="num">Gold/min</th><th class="num">Matches</th></tr></thead>
                            <tbody>
                                ${data.characters.map((c) => {
                                    const cs = data.characterStats[c.id];

                                    return html`<tr>
                                        <td class="nowrap">${c.online ? html`<span class="dot on" title="online"></span>` : ''}${characterLink(c.id, c.name)}
                                            ${c.dead ? html`<span class="badge sev-3">dead</span>` : ''}${c.hardcore ? html` <span class="badge">HC</span>` : ''}${c.season ? html` <span class="badge">season</span>` : ''}</td>
                                        <td>${c.level}</td><td>${c.className ?? ''}</td><td>${c.raceName ?? ''}</td><td class="muted">${c.serverName ?? ''}</td>
                                        <td>${c.guildName ? html`<a href="/guilds/${c.guild}">${c.guildName}</a>` : html`<span class="muted">-</span>`}</td>
                                        <td class="num">${num((c.playtime ?? 0) / 3600)} h</td>
                                        <td class="${c.online ? '' : 'muted'}">${c.online ? locationText(c.location) : (c.lastSession ? ago(c.lastSession) : '-')}</td>
                                        <td class="num">${cs ? num(cs.goldPerMinute, 1) : '-'}</td>
                                        <td class="num">${cs ? num(cs.matches) : '-'}</td>
                                    </tr>`;
                                })}
                            </tbody>
                        </table></div>
                    </div>
                </div>

                <div class="row" style="justify-content:space-between;margin-bottom:8px">
                    <h3 style="margin:0">Statistics</h3>
                    <div class="toggle" id="days">${[1, 5, 14, 30].map((d) => html`<button type="button" data-days="${d}" class="${d === days ? 'active' : ''}">${d === 1 ? '24h' : d + ' days'}</button>`)}</div>
                </div>
                ${kpis(s, data.limits, days)}

                ${tabs(TABS.map(([k, l]) => [k, k === 'flags' ? l + ' (' + openFlags.length + ')' : (k === 'reports' ? l + ' (' + data.reports.received.total + ')' : l)]), tab)}
                <div id="tab"></div>
            </div>`);

        showTab();
    };

    const showTab = async () => {
        $$('.tabs [data-tab]', root).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        const box = $('#tab', root);
        charts.forEach((c) => c?.destroy());
        charts = [];

        try {
            switch (tab) {
                case 'overview':
                    box.innerHTML = String(activityPanels());
                    charts = activityCharts(box, data.daily, data.hourly);
                    break;
                case 'flags':
                    box.innerHTML = String(html`<div class="panel flush">${flagTable(data.flags, { account: false })}</div>`);
                    break;
                case 'chat':
                    box.innerHTML = '<div class="panel flush">Loading…</div>';
                    box.innerHTML = String(html`<div class="panel flush">${await chatTable({ account: id })}</div>`);
                    break;
                case 'drops':
                    box.innerHTML = '<div class="panel flush">Loading…</div>';
                    box.innerHTML = String(html`<div class="panel flush">${await dropTable({ account: id })}</div>`);
                    break;
                case 'trades':
                    box.innerHTML = '<div class="panel flush">Loading…</div>';
                    box.innerHTML = String(html`<div class="panel flush">${await tradeTable({ account: id })}</div>`);
                    break;
                case 'auctions':
                    box.innerHTML = String(auctions());
                    break;
                case 'logins':
                    box.innerHTML = String(logins());
                    break;
                case 'achievements':
                    box.innerHTML = '<div class="panel">Loading…</div>';
                    box.innerHTML = String(await achievements());
                    break;
                case 'log':
                    box.innerHTML = String(actionLog());
                    break;
                case 'inventory':
                    await inventoryTab(box);
                    break;
                case 'quests':
                    questTab(box);
                    break;
                case 'reports':
                    box.innerHTML = '<div class="panel">Loading…</div>';
                    await reportsTab(box);
                    break;
                default:
                    box.innerHTML = '';
            }
        } catch (error) {
            box.innerHTML = String(html`<div class="error-box">${error.message}</div>`);
        }
    };

    let inventoryOwner = 'account';
    const inventoryTab = async (box) => {
        const alive = data.characters.filter((c) => !c.dead);
        box.innerHTML = String(html`
            <div class="filters">
                <label>Inventory
                    <select data-inventory-owner>
                        <option value="account" ${inventoryOwner === 'account' ? 'selected' : ''}>Account stash (shared)</option>
                        ${alive.map((c) => html`<option value="${c.id}" ${inventoryOwner === String(c.id) ? 'selected' : ''}>Backpack of ${c.name} (lvl ${c.level})</option>`)}
                    </select>
                </label>
            </div>
            <div data-inventory></div>`);

        const show = () => renderInventory($('[data-inventory]', box), inventoryOwner === 'account'
            ? { type: 'account', id, title: 'Account stash' }
            : { type: 'character', id: Number(inventoryOwner), title: 'Backpack' }).catch(errorToast);

        $('[data-inventory-owner]', box).addEventListener('change', (event) => {
            inventoryOwner = event.target.value;
            show();
        });

        await show();
    };

    let questCharacter = null;
    const questTab = (box) => {
        const list = data.characters;
        questCharacter = questCharacter ?? list[0]?.id ?? null;
        box.innerHTML = String(html`
            <div class="filters">
                <label>Character
                    <select data-quest-character>${list.map((c) => html`<option value="${c.id}" ${questCharacter === c.id ? 'selected' : ''}>${c.name} (lvl ${c.level})</option>`)}</select>
                </label>
            </div>
            <div data-quests></div>`);

        const show = () => (questCharacter ? renderQuests($('[data-quests]', box), questCharacter).catch(errorToast) : null);
        $('[data-quest-character]', box)?.addEventListener('change', (event) => {
            questCharacter = Number(event.target.value);
            show();
        });
        show();
    };

    const reportsTab = async (box) => {
        const r = data.reports;
        const [filed, received] = await Promise.all([
            get('/api/reports?status=all&limit=100&reporter=' + id),
            get('/api/reports?status=all&limit=100&account=' + id),
        ]);
        const pct = (v) => (v === null ? '-' : Math.round(v * 100) + '%');
        const a = data.account;

        box.innerHTML = String(html`
            <div class="kpis">
                <div class="kpi"><div class="label">Reports filed</div><div class="value">${num(r.filed.total)}</div><div class="hint">against ${r.filed.players} player(s) · ${r.filed.open} open</div></div>
                <div class="kpi ${r.filed.accuracy !== null && r.filed.actions + r.filed.rejected >= 5 && r.filed.accuracy < 0.25 ? 'alert' : ''}"><div class="label">…resulting in an action</div><div class="value">${num(r.filed.actions)}</div><div class="hint">${pct(r.filed.accuracy)} of the handled · ${r.filed.rejected} unfounded</div></div>
                <div class="kpi"><div class="label">Reports received</div><div class="value">${num(r.received.total)}</div><div class="hint">from ${r.received.players} player(s) · ${r.received.open} open</div></div>
                <div class="kpi ${r.received.actions > 0 ? 'warn' : ''}"><div class="label">…resulting in an action</div><div class="value">${num(r.received.actions)}</div><div class="hint">${pct(r.received.accuracy)} of the handled</div></div>
                <div class="kpi ${a.reportBlocked ? 'alert' : ''}"><div class="label">Reporting</div><div class="value">${a.reportBlocked ? 'blocked' : 'allowed'}</div>
                    <div class="hint">${a.reportBlocked ? 'until ' + dateTime(a.reportBlockedUntil) : ''}</div>
                    <div style="margin-top:6px">${a.reportBlocked ? html`<button class="small" data-action="unblock_reports">Allow reports</button>` : html`<button class="small danger" data-action="block_reports">Block reporting</button>`}</div></div>
            </div>
            <div class="panel flush" style="margin-bottom:14px"><h2>Reports filed by ${a.name}</h2>${reportTable(filed, { reporter: false })}</div>
            <div class="panel flush"><h2>Reports against ${a.name}</h2>${reportTable(received, { target: false })}</div>`);
    };

    const auctions = () => html`
        <div class="panel flush"><div class="table-wrap scroll"><table>
            <thead><tr><th>#</th><th>Side</th><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Per unit</th><th class="num">Avg per unit</th><th>Seller</th><th>Buyer</th><th>Listed</th><th>Sold after</th></tr></thead>
            <tbody>
                ${data.auctions.map((x) => {
                    const unit = x.price / Math.max(1, x.quantity);
                    const factor = x.avgUnit > 0 ? unit / x.avgUnit : 1;

                    return html`<tr>
                        <td class="muted">${x.id}</td>
                        <td><span class="badge">${x.side}</span></td>
                        <td>${x.itemName ?? '#' + x.item}</td>
                        <td class="num">${x.quantity}</td>
                        <td class="num">${num(x.price)}</td>
                        <td class="num ${factor > 4 || factor < 0.25 ? 'hot' : ''}">${num(unit)}</td>
                        <td class="num muted">${num(x.avgUnit)}</td>
                        <td>${characterLink(x.seller, x.sellerName)}</td>
                        <td>${x.buyer ? characterLink(x.buyer, x.buyerName) : html`<span class="muted">${['open', 'sold', 'expired'][x.state] ?? ''}</span>`}</td>
                        <td class="muted nowrap">${dateTime(x.start)}</td>
                        <td class="nowrap ${x.sold && x.sold - x.start < 30 ? 'hot' : ''}">${x.sold ? duration(x.sold - x.start) : '-'}</td>
                    </tr>`;
                })}
                ${data.auctions.length === 0 ? html`<tr class="empty-row"><td colspan="11">No auctions</td></tr>` : ''}
            </tbody>
        </table></div></div>`;

    const logins = () => html`
        <div class="grid side">
            <div class="panel flush"><h2>Game logins</h2><div class="table-wrap scroll"><table>
                <thead><tr><th>Login</th><th>Logout</th><th>Duration</th><th>IP</th><th>Hardware</th></tr></thead>
                <tbody>
                    ${data.logins.map((l) => html`<tr>
                        <td class="nowrap">${dateTime(l.time)}</td>
                        <td class="nowrap">${l.end ? dateTime(l.end) : html`<span class="badge online">online</span>`}</td>
                        <td>${duration((l.end ?? Date.now() / 1000) - l.time)}</td>
                        <td class="mono">${l.ip}</td>
                        <td class="mono">${l.hardware}</td>
                    </tr>`)}
                    ${data.logins.length === 0 ? html`<tr class="empty-row"><td colspan="5">No logins</td></tr>` : ''}
                </tbody>
            </table></div></div>
            <div class="panel flush"><h2>Accounts with the same IP or hardware</h2><table>
                <tbody>
                    ${data.related.map((r) => html`<tr>
                        <td>${accountLink(r.id, r.name)} ${r.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}</td>
                        <td>${r.sameHardware ? html`<span class="badge sev-2">same hardware</span>` : ''} ${r.sameIp ? html`<span class="badge">same IP</span>` : ''}</td>
                    </tr>`)}
                    ${data.related.length === 0 ? html`<tr class="empty-row"><td>None</td></tr>` : ''}
                </tbody>
            </table></div>
        </div>`;

    const actionLog = () => html`
        <div class="panel flush"><div class="table-wrap"><table>
            <thead><tr><th>Time</th><th>Moderator</th><th>Action</th><th>Character</th><th>Detail</th></tr></thead>
            <tbody>
                ${data.actions.map((x) => html`<tr>
                    <td class="nowrap muted">${dateTime(x.time)}</td>
                    <td>${x.moderatorName ?? html`<span class="muted">System</span>`}</td>
                    <td><span class="badge">${x.type.replace('_', ' ')}</span></td>
                    <td>${characterLink(x.character, x.characterName)}</td>
                    <td class="small">${typeof x.detail === 'string' ? x.detail : actionText(x.detail)}</td>
                </tr>`)}
                ${data.actions.length === 0 ? html`<tr class="empty-row"><td colspan="5">No notes or actions yet</td></tr>` : ''}
            </tbody>
        </table></div></div>`;

    let achievementList = [];
    const achievements = async () => {
        achievementList = (await get('/api/players/' + id + '/achievements')).achievements;
        const categories = [...new Set(achievementList.map((x) => x.category))];

        return html`
            <div class="panel flush"><div class="table-wrap"><table>
                <thead><tr><th>Achievement</th><th>Category</th><th>Progress</th><th>Tiers</th><th></th></tr></thead>
                <tbody>
                    ${categories.map((cat) => achievementList.filter((x) => x.category === cat).map((x) => html`<tr>
                        <td><b>${x.name}</b><div class="small muted">${x.description ?? ''}</div></td>
                        <td class="muted">${cat}</td>
                        <td class="num">${num(x.progress)}</td>
                        <td>${x.tiers.map((need, i) => {
                            const got = x.unlocked.find((u) => u.tier === i + 1);

                            return html`<span class="badge ${got ? 'ok' : ''}" title="${got ? 'unlocked ' + got.date : 'needs ' + need}">${['I', 'II', 'III', 'IV', 'V'][i]}</span> `;
                        })}</td>
                        <td class="nowrap">
                            <button class="small" data-award="${x.id}">Award</button>
                            ${x.unlocked.length > 0 ? html`<button class="small ghost" data-revoke="${x.id}">Revoke</button>` : ''}
                        </td>
                    </tr>`))}
                </tbody>
            </table></div></div>`;
    };

    const award = async (typeId = null) => {
        if (achievementList.length === 0) {
            achievementList = (await get('/api/players/' + id + '/achievements')).achievements;
        }

        await dialog({
            title: 'Award achievement to ' + data.account.name,
            text: 'All tiers up to the selected tier are unlocked. The action is logged.',
            body: html`
                <label>Achievement
                    <select name="type" required>
                        <option value="">Select…</option>
                        ${achievementList.map((x) => html`<option value="${x.id}" ${x.id === typeId ? 'selected' : ''}>${x.category}: ${x.name} (${x.tiers.length} tier${x.tiers.length > 1 ? 's' : ''})</option>`)}
                    </select>
                </label>
                <label>Tier <select name="tier"></select></label>
                <label>Reason <textarea name="reason" maxlength="500" placeholder="e.g. compensation for a bug, event winner" required></textarea></label>`,
            submit: 'Award',
            onOpen: (form) => {
                const tiers = () => {
                    const type = achievementList.find((x) => x.id === Number(form.type.value));
                    const unlocked = type?.unlocked.map((u) => u.tier) ?? [];
                    form.tier.innerHTML = String(html`${(type?.tiers ?? [1]).map((need, i) => html`<option value="${i + 1}" ${unlocked.includes(i + 1) ? 'disabled' : ''}>
                        ${['I', 'II', 'III', 'IV', 'V'][i]} (score ${num(need)})${unlocked.includes(i + 1) ? ' - already unlocked' : ''}</option>`)}`);
                    const free = [...form.tier.options].find((o) => !o.disabled);
                    if (free) {
                        form.tier.value = free.value;
                    }
                };

                form.type.addEventListener('change', tiers);
                tiers();
            },
            onSubmit: async (values) => {
                const result = await post('/api/players/' + id + '/achievements', { type: Number(values.type), tier: Number(values.tier), reason: values.reason });
                toast(result.message);
                tab = 'achievements';
                await load();
            },
        });
    };

    root.addEventListener('click', async (event) => {
        const tabButton = event.target.closest('[data-tab]');
        if (tabButton) {
            tab = tabButton.dataset.tab;
            history.replaceState(null, '', location.pathname + location.search + '#' + tab);
            showTab();

            return;
        }

        const tabLink = event.target.closest('[data-tab-link]');
        if (tabLink) {
            event.preventDefault();
            tab = tabLink.dataset.tabLink;
            history.replaceState(null, '', location.pathname + location.search + '#' + tab);
            showTab();

            return;
        }

        const daysButton = event.target.closest('[data-days]');
        if (daysButton) {
            navigate(location.pathname + '?days=' + daysButton.dataset.days + location.hash, true);

            return;
        }

        const awardButton = event.target.closest('[data-award]');
        if (awardButton) {
            award(Number(awardButton.dataset.award)).catch(errorToast);

            return;
        }

        const revokeButton = event.target.closest('[data-revoke]');
        if (revokeButton) {
            const type = achievementList.find((x) => x.id === Number(revokeButton.dataset.revoke));
            await dialog({
                title: 'Revoke ' + type.name,
                body: html`
                    <label>Remove from tier <select name="tier">${type.unlocked.map((u) => html`<option value="${u.tier}">${['I', 'II', 'III', 'IV', 'V'][u.tier - 1]} (and higher)</option>`)}</select></label>
                    <label>Reason <textarea name="reason" maxlength="500" required></textarea></label>`,
                submit: 'Revoke',
                danger: true,
                onSubmit: async (values) => {
                    const result = await post('/api/players/' + id + '/achievements/revoke', { type: type.id, tier: Number(values.tier), reason: values.reason });
                    toast(result.message);
                    await load();
                },
            });

            return;
        }

        const button = event.target.closest('[data-action]');
        if (button === null) {
            return;
        }

        const name = data.account.name;
        const status = (action, extra = {}) => post('/api/players/' + id + '/status', { action, ...extra }).then(async (r) => { toast(r.message + ': ' + action); await load(); });

        try {
            switch (button.dataset.action) {
                case 'mute':
                    await dialog({
                        title: 'Mute ' + name,
                        text: 'The account can not use the chat until the time is over.',
                        body: html`
                            <label>Duration <select name="minutes"><option value="15">15 minutes</option><option value="60" selected>1 hour</option><option value="1440">1 day</option><option value="10080">7 days</option><option value="43200">30 days</option></select></label>
                            <label>Reason <textarea name="reason" maxlength="500"></textarea></label>`,
                        submit: 'Mute',
                        danger: true,
                        onSubmit: (v) => status('mute', { minutes: Number(v.minutes), reason: v.reason }),
                    });
                    break;
                case 'unmute':
                    await status('unmute');
                    break;
                case 'ban':
                    await dialog({
                        title: 'Ban ' + name,
                        text: 'The account can no longer sign in (game and website). All characters are affected. A temporary ban is lifted automatically.',
                        body: html`
                            <label>Duration
                                <select name="minutes">
                                    <option value="">Permanent</option>
                                    <option value="60">1 hour</option><option value="1440">1 day</option><option value="4320">3 days</option>
                                    <option value="10080" selected>7 days</option><option value="20160">14 days</option><option value="43200">30 days</option>
                                    <option value="129600">90 days</option><option value="525600">1 year</option>
                                    <option value="custom">Custom…</option>
                                </select>
                            </label>
                            <label data-custom hidden>Days <input type="number" name="days" min="1" max="3650" value="7"></label>
                            <label>Reason (required) <textarea name="reason" maxlength="500" required></textarea></label>`,
                        submit: 'Ban account',
                        danger: true,
                        onOpen: (form) => form.minutes.addEventListener('change', () => {
                            form.querySelector('[data-custom]').hidden = form.minutes.value !== 'custom';
                        }),
                        onSubmit: (v) => status('ban', {
                            minutes: v.minutes === 'custom' ? Math.round(Number(v.days) * 1440) : (v.minutes === '' ? null : Number(v.minutes)),
                            reason: v.reason,
                        }),
                    });
                    break;
                case 'unban':
                    await dialog({
                        title: 'Unban ' + name,
                        body: html`<label>Reason <textarea name="reason" maxlength="500"></textarea></label>`,
                        submit: 'Unban',
                        onSubmit: (v) => status('unban', { reason: v.reason }),
                    });
                    break;
                case 'award':
                    await award();
                    break;
                case 'block_reports':
                    await dialog({
                        title: 'Block reporting for ' + name,
                        text: 'The player can not send reports during this time (e.g. because of many false reports). Use Ban for serious cases.',
                        body: html`
                            <label>Duration <select name="minutes"><option value="1440">1 day</option><option value="10080" selected>7 days</option><option value="43200">30 days</option><option value="525600">1 year</option></select></label>
                            <label>Reason <textarea name="reason" maxlength="500" required>Many false reports</textarea></label>`,
                        submit: 'Block reporting',
                        danger: true,
                        onSubmit: (v) => status('block_reports', { minutes: Number(v.minutes), reason: v.reason }),
                    });
                    break;
                case 'unblock_reports':
                    await status('unblock_reports');
                    break;
                case 'note':
                    await dialog({
                        title: 'Note about ' + name,
                        text: 'Notes are only visible for the team.',
                        body: html`<label>Note <textarea name="text" maxlength="2000" required></textarea></label>`,
                        submit: 'Save note',
                        onSubmit: async (v) => {
                            await post('/api/players/' + id + '/note', { text: v.text });
                            toast('Note saved');
                            tab = 'log';
                            await load();
                        },
                    });
                    break;
                default:
            }
        } catch (error) {
            errorToast(error);
        }
    });

    await load();
    bindFlagReview(root, load);
    bindReportReview(root, load);

    const off = live.on('flags', () => {});

    return () => {
        off();
        charts.forEach((c) => c?.destroy());
    };
}

export function actionText (d)
{
    if (d === null || typeof d !== 'object') {
        return String(d ?? '');
    }

    const parts = [];
    if (d.minutes) parts.push(d.minutes >= 1440 ? (d.minutes / 1440) + ' day(s)' : d.minutes + ' min');
    if (d.permanent) parts.push('permanent');
    if (d.name) parts.push((d.quantity && d.uid ? d.quantity + '× ' : '') + d.name + (d.tier ? ' tier ' + d.tier : ''));
    if (d.owner) parts.push(d.owner);
    if (d.uid) parts.push('item ' + d.uid.slice(0, 8));
    if (d.report) parts.push('report #' + d.report);
    if (d.rule) parts.push(d.rule);
    if (d.result) parts.push('message #' + d.message + ': ' + d.result);
    if (d.word) parts.push('"' + d.word + '"');
    if (d.changed) parts.push(Object.entries(d.changed).map(([k, v]) => k + ' = ' + v).join(', '));
    if (d.reason) parts.push(d.reason);
    if (d.note) parts.push(d.note);

    return parts.join(' · ');
}
