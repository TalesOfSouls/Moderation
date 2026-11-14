/**
 * Statistics blocks shared by the player and the character profile
 */
import { html, $, num, compact, duration, chart, COLORS, get, qs, clock, dateTime, ago, accountLink, characterLink, RARITY_CLASS } from './core.js';
import { highlight } from './flagview.js';

export function kpis (s, limits, days)
{
    const hot = (value, limit) => (limit !== undefined && value > limit ? 'alert' : '');

    return html`
        <div class="kpis">
            <div class="kpi ${hot(s.goldPerMinute, limits.goldPerMinute)}"><div class="label">Gold / minute</div><div class="value">${num(s.goldPerMinute, 1)}</div><div class="hint">${compact(s.gold)} gold earned · limit ${num(limits.goldPerMinute)}</div></div>
            <div class="kpi ${hot(s.xpPerMinute, limits.xpPerMinute)}"><div class="label">XP / minute</div><div class="value">${num(s.xpPerMinute)}</div><div class="hint">${compact(s.xp)} xp · limit ${num(limits.xpPerMinute)}</div></div>
            <div class="kpi ${hot(s.playtime5, limits.playtime5)}"><div class="label">Playtime last 5 days</div><div class="value">${duration(s.playtime5)}</div><div class="hint">${num(s.playtime5 / 5 / 3600, 1)} h per day</div></div>
            <div class="kpi"><div class="label">Playtime (${days}d)</div><div class="value">${duration(s.playtime)}</div><div class="hint">${s.sessions} sessions</div></div>
            <div class="kpi"><div class="label">Matches played</div><div class="value">${num(s.matches)}</div><div class="hint">${s.wins} wins · ${s.losses} losses</div></div>
            <div class="kpi"><div class="label">Win / loss ratio</div><div class="value">${s.matches > 0 ? num(s.winRatio, 2) : '-'}</div><div class="hint">${s.matches > 0 ? Math.round(s.wins / Math.max(1, s.wins + s.losses) * 100) + '% won' : 'no matches'}</div></div>
            <div class="kpi"><div class="label">Average DPS</div><div class="value">${num(s.avgDps)}</div><div class="hint">peak ${num(s.peakDps)} DPS</div></div>
            <div class="kpi"><div class="label">Peak damage</div><div class="value">${compact(s.peakDamage)}</div><div class="hint">in one encounter</div></div>
            <div class="kpi"><div class="label">Average healing</div><div class="value">${num(s.avgHps)}</div><div class="hint">peak ${num(s.peakHps)} HPS</div></div>
            <div class="kpi"><div class="label">Peak healing</div><div class="value">${compact(s.peakHealing)}</div><div class="hint">in one encounter</div></div>
            <div class="kpi ${hot(s.maxApm, limits.maxApm)}"><div class="label">Max APM</div><div class="value">${num(s.maxApm)}</div><div class="hint">limit ${num(limits.maxApm)}</div></div>
            <div class="kpi"><div class="label">Item drops</div><div class="value">${num(s.drops)}</div><div class="hint">${num(s.dropsPerMinute, 2)} per minute</div></div>
        </div>`;
}

export function activityPanels ()
{
    return html`
        <div class="grid cols-2">
            <div class="panel"><h2>Activity per day (14 days)</h2><div class="chart-box"><canvas data-chart="daily"></canvas></div></div>
            <div class="panel"><h2>Playtime per hour of the day (14 days, your local time)</h2><div class="chart-box"><canvas data-chart="hourly"></canvas></div></div>
        </div>`;
}

export function activityCharts (root, daily, hourly)
{
    const charts = [];
    charts.push(chart($('[data-chart="daily"]', root), {
        type: 'bar',
        data: {
            labels: daily.map((d) => d.date.slice(5)),
            datasets: [
                { label: 'Playtime (h)', data: daily.map((d) => Math.round(d.playtime / 36) / 100), backgroundColor: COLORS[0], yAxisID: 'h' },
                { type: 'line', label: 'Gold', data: daily.map((d) => d.gold), borderColor: COLORS[1], backgroundColor: COLORS[1], yAxisID: 'g', pointRadius: 2, tension: 0.25 },
                { type: 'line', label: 'XP', data: daily.map((d) => d.xp), borderColor: COLORS[4], backgroundColor: COLORS[4], yAxisID: 'x', pointRadius: 2, tension: 0.25, hidden: true },
                { type: 'line', label: 'Item drops', data: daily.map((d) => d.drops), borderColor: COLORS[2], backgroundColor: COLORS[2], yAxisID: 'g2', pointRadius: 2, tension: 0.25, hidden: true },
            ],
        },
        options: {
            interaction: { mode: 'index', intersect: false },
            scales: {
                h: { beginAtZero: true, max: 24, title: { display: true, text: 'hours' } },
                g: { position: 'right', beginAtZero: true, grid: { display: false } },
                x: { display: false, beginAtZero: true },
                g2: { display: false, beginAtZero: true },
            },
        },
    }));

    // the server counts in UTC, shift to the local time of the moderator
    const offset = -new Date().getTimezoneOffset() / 60;
    const local = hourly.map((_, h) => hourly[((h - offset) % 24 + 24) % 24]);

    charts.push(chart($('[data-chart="hourly"]', root), {
        type: 'bar',
        data: { labels: local.map((_, h) => String(h).padStart(2, '0')), datasets: [{ label: 'Hours played', data: local, backgroundColor: COLORS[5] }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'hours' } } } },
    }));

    return charts;
}

/**
 * Chat, drops and trades of an account or character (tabs of the profiles)
 */
export async function chatTable (filter)
{
    const rows = await get('/api/chat' + qs({ ...filter, limit: 150 }));

    return html`
        <div class="table-wrap scroll"><table class="feed">
            <thead><tr><th>Time</th><th>Channel</th><th>Character</th><th>Message</th><th>Zone</th></tr></thead>
            <tbody>
                ${rows.map((m) => html`<tr class="${m.badWords.length > 0 ? 'flagged' : ''}">
                    <td class="time">${dateTime(m.time)}</td>
                    <td><span class="channel c-${m.channel}">${m.channelName}</span></td>
                    <td class="nowrap">${characterLink(m.character, m.characterName)}</td>
                    <td class="msg" data-chat-context="${m.id}" title="Show the conversation">${m.toCharacter ? html`<span class="muted">→ ${characterLink(m.toCharacter, m.toName)}:</span> ` : ''}${highlight(m.text, m.badWords)}</td>
                    <td class="small muted">${m.zoneName ?? ''}</td>
                </tr>`)}
                ${rows.length === 0 ? html`<tr class="empty-row"><td colspan="5">No messages</td></tr>` : ''}
            </tbody>
        </table></div>
        <div style="padding:8px 14px"><a href="/chat${qs(filter)}">Open in the live chat</a></div>`;
}

export async function dropTable (filter)
{
    const rows = await get('/api/drops' + qs({ ...filter, limit: 150 }));

    return html`
        <div class="table-wrap scroll"><table class="feed">
            <thead><tr><th>Time</th><th>Drop</th><th>Source</th><th>Character</th><th>Where</th></tr></thead>
            <tbody>
                ${rows.map((d) => html`<tr>
                    <td class="time">${dateTime(d.time)}</td>
                    <td class="nowrap">${d.type === 'gold' ? html`<b class="warn">${num(d.amount)} gold</b>` : html`<span class="${RARITY_CLASS[d.rarity] ?? ''}">${d.amount > 1 ? d.amount + '× ' : ''}${d.itemName}</span>`}</td>
                    <td class="small">${d.source}${d.mobName ? html` · <span class="muted">${d.mobName}</span>` : ''}</td>
                    <td class="nowrap">${characterLink(d.character, d.characterName)}</td>
                    <td class="small nowrap">${d.zoneName ?? '-'} ${d.x !== null ? html`<span class="muted mono">(${Math.round(d.x)}, ${Math.round(d.y)})</span>` : ''}</td>
                </tr>`)}
                ${rows.length === 0 ? html`<tr class="empty-row"><td colspan="5">No drops</td></tr>` : ''}
            </tbody>
        </table></div>
        <div style="padding:8px 14px"><a href="/drops${qs(filter)}">Open in the live drops</a></div>`;
}

export async function tradeTable (filter)
{
    const rows = await get('/api/trades' + qs({ ...filter, limit: 100 }));
    const side = (gold, items) => html`${gold > 0 ? html`<span class="warn">${num(gold)} gold</span> ` : ''}${items.map((i) => html`<span class="${RARITY_CLASS[i.rarity] ?? ''}">${i.quantity}× ${i.name}</span> `)}${gold === 0 && items.length === 0 ? html`<span class="muted">nothing</span>` : ''}`;

    return html`
        <div class="table-wrap scroll"><table class="feed">
            <thead><tr><th>#</th><th>State</th><th>Time</th><th>Player 1</th><th>Gives</th><th>Player 2</th><th>Gives</th></tr></thead>
            <tbody>
                ${rows.map((t) => html`<tr class="${t.oneSided ? 'flagged' : ''}">
                    <td class="muted">${t.id}</td>
                    <td><span class="badge ${t.stateName}">${t.stateName}</span>${t.oneSided ? html` <span class="badge sev-3">one-sided</span>` : ''}</td>
                    <td class="time">${dateTime(t.updated)}</td>
                    <td class="nowrap">${characterLink(t.character1, t.name1)}<div class="small">${accountLink(t.account1, t.accountName1)}</div></td>
                    <td class="small">${side(t.gold1, t.items1)}</td>
                    <td class="nowrap">${characterLink(t.character2, t.name2)}<div class="small">${accountLink(t.account2, t.accountName2)}</div></td>
                    <td class="small">${side(t.gold2, t.items2)}</td>
                </tr>`)}
                ${rows.length === 0 ? html`<tr class="empty-row"><td colspan="7">No trades</td></tr>` : ''}
            </tbody>
        </table></div>
        <div style="padding:8px 14px"><a href="/trades${qs(filter)}">Open in the trade list</a></div>`;
}

export function tabs (list, active)
{
    return html`<div class="tabs" role="tablist">${list.map(([key, label]) => html`<button type="button" data-tab="${key}" class="${key === active ? 'active' : ''}">${label}</button>`)}</div>`;
}

export { ago, clock };
