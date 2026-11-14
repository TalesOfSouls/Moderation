import { html, $, get, num, compact, dateTime, clock, duration, chart, COLORS, accountLink, characterLink, RARITY_CLASS } from '../core.js';
import { flagTable, bindFlagReview, highlight } from '../flagview.js';
import { result, TYPE_NAME } from './encounters.js';
import { navigate } from '../app.js';

export async function render (view, params)
{
    const id = Number(params[0]);
    const data = await get('/api/encounters/' + id);
    const e = data.encounter;
    const pvp = e.type === 'pvp';
    const charts = [];

    const items = data.drops.filter((d) => d.type === 'item');
    const gold = data.drops.filter((d) => d.type === 'gold');
    const goldTotal = gold.reduce((s, d) => s + d.amount, 0);
    const end = e.startTime + e.duration;
    const teams = pvp ? [1, 2] : [null];
    const bosses = { ...e, bosses: data.bosses.length, bossesKilled: data.bosses.filter((b) => b.killed).length };
    const wipes = data.bosses.reduce((s, b) => s + b.attempts.filter((a) => !a.kill).length, 0);

    // gold per player
    const goldPer = new Map();
    for (const g of gold) {
        goldPer.set(g.character, { name: g.characterName, account: g.account, accountName: g.accountName, gold: (goldPer.get(g.character)?.gold ?? 0) + g.amount });
    }

    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    root.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div>
                    <div class="row"><span class="badge type-${e.type}">${TYPE_NAME[e.type] ?? e.type}</span><span class="muted">#${e.id}</span></div>
                    <h1>${e.instanceName ?? 'Unknown instance'} <span class="muted small">${e.mode ?? e.difficulty ?? ''}${e.size ? ' · ' + e.size + ' players' : ''}</span></h1>
                    <div class="sub">${dateTime(e.startTime)} – ${clock(end)} · ${duration(e.duration)} ${e.short ? html`<span class="badge sev-2">suspiciously short</span>` : ''}</div>
                </div>
                <div class="actions"><a class="button" href="/encounters?type=${e.type}">All ${TYPE_NAME[e.type] ?? ''} entries</a></div>
            </div>

            <div class="kpis">
                <div class="kpi"><div class="label">Result</div><div class="value" style="font-size:16px">${result(bosses)}</div></div>
                <div class="kpi"><div class="label">Players</div><div class="value">${data.members.length}</div><div class="hint">${data.members.filter((m) => m.flags > 0).length} with open flags</div></div>
                ${pvp ? '' : html`<div class="kpi"><div class="label">Bosses</div><div class="value">${bosses.bossesKilled} / ${bosses.bosses}</div><div class="hint">${wipes} wipe(s)</div></div>`}
                <div class="kpi"><div class="label">Chat messages</div><div class="value">${data.chat.length}</div><div class="hint">${data.chat.filter((m) => m.badWords.length > 0).length} offensive</div></div>
                <div class="kpi"><div class="label">Item drops</div><div class="value">${items.length}</div><div class="hint">${items.filter((i) => i.rarity >= 5).length} green or better</div></div>
                <div class="kpi"><div class="label">Gold looted</div><div class="value">${compact(goldTotal)}</div></div>
                <div class="kpi ${data.members.some((m) => m.apm > data.limits.maxApm) ? 'alert' : ''}"><div class="label">Max APM</div><div class="value">${num(Math.max(0, ...data.members.map((m) => m.apm ?? 0)))}</div><div class="hint">limit ${data.limits.maxApm}</div></div>
            </div>

            ${data.flags.length > 0 ? html`<div class="panel flush" style="margin-bottom:14px"><h2>Flags about this ${pvp ? 'match' : 'run'}</h2>${flagTable(data.flags)}</div>` : ''}

            ${teams.map((team) => {
                const members = data.members.filter((m) => team === null || m.team === team);

                return html`<div class="panel flush" style="margin-bottom:14px">
                    <h2>${team === null ? 'Players' : html`Team ${team} ${e.winner === team ? html`<span class="badge ok">winner</span>` : ''}`}</h2>
                    <div class="table-wrap"><table>
                        <thead><tr><th>Character</th><th>Account</th><th>Class</th><th>Role</th><th class="num">Damage</th><th class="num">DPS</th><th class="num">Healing</th><th class="num">HPS</th>
                            <th class="num">Taken</th><th class="num">K / D / A</th><th class="num">APM</th><th class="num">Active</th>${pvp ? html`<th class="num">Rating</th>` : ''}</tr></thead>
                        <tbody>
                            ${members.map((m) => html`<tr>
                                <td class="nowrap">${characterLink(m.character, m.name)} <span class="muted small">lvl ${m.level}</span></td>
                                <td class="nowrap">${accountLink(m.account, m.accountName)} ${m.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}
                                    ${m.flags > 0 ? html`<a href="/flags?account=${m.account}" class="badge sev-2">${m.flags} flags</a>` : ''}</td>
                                <td class="small">${m.className ?? ''}</td>
                                <td class="small">${m.role ?? ''}</td>
                                <td class="num">${compact(m.damage)}</td>
                                <td class="num">${num(m.dps)}</td>
                                <td class="num">${compact(m.healing)}</td>
                                <td class="num">${num(m.hps)}</td>
                                <td class="num">${compact(m.damageTaken)}</td>
                                <td class="num nowrap">${m.kills ?? 0} / ${m.deaths ?? 0} / ${m.assists ?? 0}</td>
                                <td class="num ${m.apm > data.limits.maxApm ? 'hot' : ''}">${num(m.apm, 1)}</td>
                                <td class="num">${m.active ?? '-'}%</td>
                                ${pvp ? html`<td class="num nowrap">${m.rating ?? '-'} <span class="${m.ratingChange >= 0 ? 'ok' : 'bad'}">${m.ratingChange >= 0 ? '+' : ''}${m.ratingChange ?? ''}</span></td>` : ''}
                            </tr>`)}
                        </tbody>
                    </table></div>
                </div>`;
            })}

            <div class="grid cols-2">
                ${pvp ? html`
                    <div class="panel"><h2>Score</h2>${data.scores.length > 1 ? html`<div class="chart-box"><canvas id="score"></canvas></div>` : html`<p class="muted">No score history recorded. Final score ${e.score1 ?? 0} : ${e.score2 ?? 0}.</p>`}</div>`
                : html`
                    <div class="panel flush"><h2>Bosses</h2><table>
                        <thead><tr><th>Boss</th><th>Result</th><th>Attempts</th></tr></thead>
                        <tbody>
                            ${data.bosses.map((b) => html`<tr>
                                <td>${b.name ?? 'Boss'}</td>
                                <td>${b.killed ? html`<span class="ok">killed</span>` : html`<span class="bad">not killed</span>`}</td>
                                <td>${b.attempts.map((a) => html`<span class="badge ${a.kill ? 'ok' : 'sev-3'}" title="${duration(a.duration)}${a.kill ? '' : ', ' + a.hpLeft + '% hp left'}">#${a.no} ${duration(a.duration)}${a.kill ? '' : ' (' + a.hpLeft + '%)'}</span> `)}</td>
                            </tr>`)}
                            ${data.bosses.length === 0 ? html`<tr class="empty-row"><td colspan="3">No bosses recorded</td></tr>` : ''}
                        </tbody>
                    </table></div>`}
                <div class="panel flush"><h2>Events</h2><div class="table-wrap scroll"><table>
                    <tbody>
                        ${data.events.map((ev) => html`<tr>
                            <td class="time">${clock(ev.time)}</td>
                            <td>${characterLink(ev.character, ev.characterName)}</td>
                            <td class="${RARITY_CLASS[ev.rarity] ?? ''}">${ev.title}${ev.detail ? html`<div class="small muted">${ev.detail}</div>` : ''}</td>
                        </tr>`)}
                        ${data.events.length === 0 ? html`<tr class="empty-row"><td>No events</td></tr>` : ''}
                    </tbody>
                </table></div></div>
            </div>

            <div class="grid cols-2" style="margin-top:14px">
                <div class="panel flush">
                    <h2>Chat <span class="muted small">(click a message for the conversation around it)</span></h2>
                    <div class="table-wrap scroll"><table class="feed">
                        <tbody>
                            ${data.chat.map((m) => html`<tr class="${m.badWords.length > 0 ? 'flagged' : ''}">
                                <td class="time">${clock(m.time)}</td>
                                <td><span class="channel c-${m.channel}">${m.channelName}</span></td>
                                <td class="nowrap">${characterLink(m.character, m.characterName)}</td>
                                <td class="msg" data-chat-context="${m.id}">${highlight(m.text, m.badWords)}</td>
                            </tr>`)}
                            ${data.chat.length === 0 ? html`<tr class="empty-row"><td>No chat messages</td></tr>` : ''}
                        </tbody>
                    </table></div>
                </div>
                <div class="panel flush">
                    <h2>Loot</h2>
                    <div class="table-wrap scroll"><table class="feed">
                        <tbody>
                            ${items.map((d) => html`<tr>
                                <td class="time">${clock(d.time)}</td>
                                <td><span class="${RARITY_CLASS[d.rarity] ?? ''}">${d.amount > 1 ? d.amount + '× ' : ''}${d.itemName}</span>${d.itemLevel ? html` <span class="muted small">lvl ${d.itemLevel}</span>` : ''}</td>
                                <td class="nowrap">${characterLink(d.character, d.characterName)}</td>
                                <td>${d.uid ? html`<a class="mono small" href="/items?uid=${d.uid}">${d.uid.slice(0, 8)}…</a>` : ''}</td>
                            </tr>`)}
                            ${items.length === 0 ? html`<tr class="empty-row"><td>No item drops</td></tr>` : ''}
                        </tbody>
                    </table></div>
                    <h2 style="padding:12px 14px 0">Gold</h2>
                    <table>
                        <tbody>
                            ${[...goldPer].sort((a, b) => b[1].gold - a[1].gold).map(([character, g]) => html`<tr>
                                <td>${characterLink(character, g.name)}</td><td>${accountLink(g.account, g.accountName)}</td><td class="num warn">${num(g.gold)} gold</td>
                            </tr>`)}
                            ${gold.length === 0 ? html`<tr class="empty-row"><td>No gold</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>`);

    if (pvp && data.scores.length > 1) {
        charts.push(chart($('#score', root), {
            type: 'line',
            data: {
                labels: data.scores.map((s) => duration(s.time)),
                datasets: [
                    { label: 'Team 1', data: data.scores.map((s) => s.score1), borderColor: COLORS[0], backgroundColor: COLORS[0], pointRadius: 0, stepped: true },
                    { label: 'Team 2', data: data.scores.map((s) => s.score2), borderColor: COLORS[3], backgroundColor: COLORS[3], pointRadius: 0, stepped: true },
                ],
            },
            options: { interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true } } },
        }));
    }

    bindFlagReview(root, () => navigate(location.pathname, true));

    return () => charts.forEach((c) => c?.destroy());
}
