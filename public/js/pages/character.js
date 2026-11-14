import { html, $, $$, get, num, dateTime, ago, duration, chart, COLORS, accountLink, severityBadge, errorToast } from '../core.js';
import { flagTable, bindFlagReview } from '../flagview.js';
import { kpis, activityPanels, activityCharts, chatTable, dropTable, tradeTable, tabs } from '../statsview.js';
import { navigate } from '../app.js';
import { renderInventory } from '../inventoryview.js';
import { renderQuests } from '../questview.js';
import { locationPanel, drawMinimap, locationText } from '../locationview.js';

const TABS = [
    ['overview', 'Overview'], ['inventory', 'Inventory'], ['quests', 'Quests'], ['encounters', 'Encounters'], ['path', 'Routes'], ['inputs', 'Input analysis'],
    ['flags', 'Flags'], ['chat', 'Chat'], ['drops', 'Drops'], ['trades', 'Trades'],
];

export async function render (view, params, query)
{
    const id = Number(params[0]);
    const days = parseInt(query.get('days') ?? '14', 10) || 14;
    let tab = location.hash.slice(1) || 'overview';
    let charts = [];

    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    const data = await get('/api/characters/' + id + '?days=' + days);
    const c = data.character;
    const a = data.account;
    const openFlags = data.flags.filter((f) => f.status === 'open');

    root.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div class="profile-head">
                    <div class="avatar">${c.name.slice(0, 1).toUpperCase()}</div>
                    <div>
                        <h1>${c.name} <span class="muted small">#${c.id}</span></h1>
                        <div class="row" style="margin-top:4px">
                            ${c.online ? html`<span class="badge online">online</span> ${locationText(c.location)}` : html`<span class="badge">offline</span>`}
                            <span class="muted">Level ${c.level} ${c.raceName ?? ''} ${c.className ?? ''}</span>
                            ${c.dead ? html`<span class="badge sev-3">dead</span>` : ''}${c.hardcore ? html`<span class="badge">hardcore</span>` : ''}
                            ${openFlags.length > 0 ? html`${severityBadge(Math.max(...openFlags.map((f) => f.severity)))} <span class="small">${openFlags.length} open flag(s)</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="actions">
                    ${a ? html`<a class="button" href="/players/${a.id}">Account ${a.name}</a><a class="button" href="/support/${a.id}">Message</a>` : ''}
                </div>
            </div>

            <div class="grid cols-3" style="margin-bottom:14px">
                <div class="panel">
                    <h3>Character</h3>
                    <dl class="facts">
                        <dt>Account</dt><dd>${a ? accountLink(a.id, a.name) : '-'} ${a && a.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}</dd>
                        <dt>Server</dt><dd>${c.serverName ?? '-'}</dd>
                        <dt>Guild</dt><dd>${c.guildName ? html`<a href="/guilds/${c.guild}">${c.guildName}</a>` : '-'}</dd>
                        <dt>Created</dt><dd>${dateTime(c.created)}</dd>
                        <dt>Season</dt><dd>${c.season ? 'Season ' + c.season : 'none (permanent)'} · ${c.hardcore ? 'Hardcore' : 'Softcore'}</dd>
                    </dl>
                </div>
                <div class="panel">
                    <h3>Progress</h3>
                    <dl class="facts">
                        <dt>Total XP</dt><dd>${num(c.xp)}</dd>
                        <dt>Item level</dt><dd>${num(c.itemLevel)}</dd>
                        <dt>Playtime</dt><dd>${num((c.playtime ?? 0) / 3600)} hours</dd>
                        <dt>Last session</dt><dd>${c.lastSession ? ago(c.lastSession) : '-'}</dd>
                    </dl>
                </div>
                <div data-location-slot>${locationPanel(c.location, c.id)}</div>
            </div>

            <div class="row" style="justify-content:space-between;margin-bottom:8px">
                <h3 style="margin:0">Statistics</h3>
                <div class="toggle" id="days">${[1, 5, 14, 30].map((d) => html`<button type="button" data-days="${d}" class="${d === days ? 'active' : ''}">${d === 1 ? '24h' : d + ' days'}</button>`)}</div>
            </div>
            ${kpis(data.stats, data.limits, days)}
            ${tabs(TABS, tab)}
            <div id="tab"></div>
        </div>`);

    const box = $('#tab', root);

    const showTab = async () => {
        $$('.tabs [data-tab]', root).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        charts.forEach((x) => x?.destroy());
        charts = [];

        try {
            switch (tab) {
                case 'overview':
                    box.innerHTML = String(activityPanels());
                    charts = activityCharts(box, data.daily, data.hourly);
                    break;
                case 'inventory':
                    await renderInventory(box, { type: 'character', id, title: 'Backpack' });
                    break;
                case 'quests':
                    await renderQuests(box, id);
                    break;
                case 'encounters':
                    box.innerHTML = String(encounters());
                    break;
                case 'path':
                    await routes();
                    break;
                case 'inputs':
                    inputs();
                    break;
                case 'flags':
                    box.innerHTML = String(html`<div class="panel flush">${flagTable(data.flags, { account: false })}</div>`);
                    break;
                case 'chat':
                    box.innerHTML = String(html`<div class="panel flush">${await chatTable({ character: id })}</div>`);
                    break;
                case 'drops':
                    box.innerHTML = String(html`<div class="panel flush">${await dropTable({ character: id })}</div>`);
                    break;
                case 'trades':
                    box.innerHTML = String(html`<div class="panel flush">${await tradeTable({ character: id })}</div>`);
                    break;
                default:
                    box.innerHTML = '';
            }
        } catch (error) {
            box.innerHTML = String(html`<div class="error-box">${error.message}</div>`);
        }
    };

    const encounters = () => html`
        <div class="panel flush"><div class="table-wrap scroll"><table>
            <thead><tr><th>#</th><th>Start</th><th>Type</th><th>Instance</th><th>Result</th><th class="num">Duration</th><th>Role</th><th class="num">DPS</th><th class="num">HPS</th><th class="num">Damage</th><th class="num">Healing</th><th class="num">K/D</th><th class="num">APM</th></tr></thead>
            <tbody>
                ${data.encounters.map((e) => html`<tr>
                    <td><a href="/encounters/${e.id}">${e.id}</a></td>
                    <td class="nowrap">${dateTime(e.start)}</td>
                    <td>${e.type}${e.mode ? html` <span class="muted small">${e.mode}</span>` : ''}</td>
                    <td>${e.instance ?? '-'}</td>
                    <td>${e.type === 'pvp' ? (e.won ? html`<span class="ok">won</span>` : html`<span class="bad">lost</span>`) : (e.success ? html`<span class="ok">success</span>` : html`<span class="muted">failed</span>`)}</td>
                    <td class="num ${e.type === 'pvp' && e.duration < 120 ? 'hot' : ''}">${duration(e.duration)}</td>
                    <td>${e.role ?? ''}</td>
                    <td class="num">${num(e.dps)}</td>
                    <td class="num">${num(e.hps)}</td>
                    <td class="num">${num(e.damage)}</td>
                    <td class="num">${num(e.healing)}</td>
                    <td class="num">${e.kills ?? 0}/${e.deaths ?? 0}</td>
                    <td class="num ${e.apm > data.limits.maxApm ? 'hot' : ''}">${num(e.apm, 1)}</td>
                </tr>`)}
                ${data.encounters.length === 0 ? html`<tr class="empty-row"><td colspan="13">No encounters</td></tr>` : ''}
            </tbody>
        </table></div></div>`;

    const routes = async (session = null) => {
        const sessions = data.sessions.filter((s) => s.points > 0);
        const path = await get('/api/characters/' + id + '/path' + (session ? '?session=' + session : ''));

        box.innerHTML = String(html`
            <div class="grid side">
                <div class="panel">
                    <div class="panel-head">
                        <h2>Route ${path.zone ? html`in ${path.zone.name}` : ''}</h2>
                        ${sessions.length > 0 ? html`<select id="session">
                            ${sessions.map((s) => html`<option value="${s.id}" ${s.id === path.session ? 'selected' : ''}>${dateTime(s.start)} · ${s.zoneName ?? ''} · ${s.points} positions</option>`)}
                        </select>` : ''}
                    </div>
                    ${path.points.length === 0 ? html`<p class="muted">No positions recorded for this character (positions are only stored for recent sessions).</p>` : html`
                        <div class="path-wrap"><canvas id="path" width="900" height="900"></canvas></div>
                        <div class="legend">
                            <span><i style="background:${COLORS[0]}"></i>selected session</span>
                            ${path.compare.map((p, i) => html`<span><i style="background:${COLORS[(i + 1) % COLORS.length]}"></i>${dateTime(p.start)}</span>`)}
                            <span>● start ■ end</span>
                        </div>`}
                </div>
                <div class="panel">
                    <h2>How to read this</h2>
                    <p class="muted">Players move between different places in every session. Bots usually walk the same loop again and again: the lines of
                    different sessions lie on top of each other. The rule <b>Repeated route</b> compares the sessions automatically
                    (grid size, similarity and number of sessions can be changed in the configuration).</p>
                    <dl class="facts">
                        <dt>Positions</dt><dd>${path.points.length}</dd>
                        <dt>Duration</dt><dd>${path.points.length > 1 ? duration(path.points.at(-1).time - path.points[0].time) : '-'}</dd>
                        <dt>Compared sessions</dt><dd>${path.compare.length}</dd>
                    </dl>
                </div>
            </div>`);

        $('#session', box)?.addEventListener('change', (event) => routes(Number(event.target.value)).catch(errorToast));

        const canvas = $('#path', box);
        if (canvas === null) {
            return;
        }

        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        const all = [path.points, ...path.compare.map((p) => p.points)].flat();
        const maxX = Math.max(1000, ...all.map((p) => p.x));
        const maxY = Math.max(1000, ...all.map((p) => p.y));
        const sx = (x) => 20 + x / maxX * (size - 40);
        const sy = (y) => 20 + y / maxY * (size - 40);

        ctx.fillStyle = '#0b0f14';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i <= 10; ++i) {
            ctx.beginPath();
            ctx.moveTo(sx(i * maxX / 10), sy(0));
            ctx.lineTo(sx(i * maxX / 10), sy(maxY));
            ctx.moveTo(sx(0), sy(i * maxY / 10));
            ctx.lineTo(sx(maxX), sy(i * maxY / 10));
            ctx.stroke();
        }

        const line = (points, color, width, alpha) => {
            if (points.length < 2) {
                return;
            }

            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(sx(points[0].x), sy(points[0].y));
            for (const p of points.slice(1)) {
                ctx.lineTo(sx(p.x), sy(p.y));
            }

            ctx.stroke();
            ctx.globalAlpha = 1;
        };

        path.compare.forEach((p, i) => line(p.points, COLORS[(i + 1) % COLORS.length], 2, 0.55));
        line(path.points, COLORS[0], 2.5, 0.95);

        if (path.points.length > 0) {
            const first = path.points[0];
            const last = path.points.at(-1);
            ctx.fillStyle = COLORS[2];
            ctx.beginPath();
            ctx.arc(sx(first.x), sy(first.y), 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = COLORS[3];
            ctx.fillRect(sx(last.x) - 6, sy(last.y) - 6, 12, 12);
        }
    };

    const inputs = () => {
        const x = data.inputs;
        box.innerHTML = String(html`
            <div class="kpis">
                <div class="kpi"><div class="label">Skill inputs (7 days)</div><div class="value">${num(x.inputs)}</div></div>
                <div class="kpi ${x.fastRatio > 0.05 ? 'alert' : ''}"><div class="label">Faster than humanly possible</div><div class="value">${num(x.fastRatio * 100, 1)}%</div><div class="hint">${num(x.fast)} of ${num(x.intervals)} intervals</div></div>
                <div class="kpi ${x.combos.some((c) => c.count >= 30 && c.cv < 0.08) ? 'alert' : ''}"><div class="label">Most regular combo</div><div class="value">${x.combos.length > 0 ? 'CV ' + num(Math.min(...x.combos.map((c) => c.cv)), 3) : '-'}</div><div class="hint">humans: usually above 0.25</div></div>
            </div>
            <div class="grid cols-2">
                <div class="panel"><h2>Time between two skill inputs</h2><div class="chart-box tall"><canvas id="histogram"></canvas></div>
                    <p class="small muted">Humans produce a wide, uneven distribution. Scripts and bots create narrow spikes (always the same delay) or inputs below ~60 ms.</p></div>
                <div class="panel flush"><h2>Most used skill combinations</h2><div class="table-wrap"><table>
                    <thead><tr><th>Combo</th><th class="num">Count</th><th class="num">Mean</th><th class="num">Std. dev.</th><th class="num">CV</th></tr></thead>
                    <tbody>
                        ${x.combos.map((cb) => html`<tr>
                            <td>${cb.from} → ${cb.to}</td><td class="num">${cb.count}</td><td class="num">${num(cb.mean)} ms</td><td class="num">${num(cb.std, 1)} ms</td>
                            <td class="num ${cb.count >= 30 && cb.cv < 0.08 ? 'hot' : ''}">${num(cb.cv, 3)}</td>
                        </tr>`)}
                        ${x.combos.length === 0 ? html`<tr class="empty-row"><td colspan="5">No skill inputs recorded</td></tr>` : ''}
                    </tbody>
                </table></div></div>
            </div>`);

        charts.push(chart($('#histogram', box), {
            type: 'bar',
            data: {
                labels: x.histogram.map((_, i) => (i * 100) + (i === 29 ? '+' : '')),
                datasets: [{ label: 'Inputs', data: x.histogram, backgroundColor: x.histogram.map((_, i) => (i === 0 ? COLORS[3] : COLORS[0])) }],
            },
            options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'milliseconds' } }, y: { beginAtZero: true } } },
        }));
    };

    root.addEventListener('click', (event) => {
        const tabButton = event.target.closest('[data-tab]');
        if (tabButton) {
            tab = tabButton.dataset.tab;
            history.replaceState(null, '', location.pathname + location.search + '#' + tab);
            showTab();

            return;
        }

        const daysButton = event.target.closest('[data-days]');
        if (daysButton) {
            navigate(location.pathname + '?days=' + daysButton.dataset.days + location.hash, true);
        }
    });

    bindFlagReview(root, () => navigate(location.pathname + location.search + '#flags', true));
    await showTab();

    // the location changes while the character plays
    drawMinimap(root, c.location);
    const locationTimer = setInterval(async () => {
        try {
            const location = await get('/api/characters/' + id + '/location');
            const slot = $('[data-location-slot]', root);
            if (slot !== null) {
                slot.innerHTML = String(locationPanel(location, id));
                drawMinimap(slot, location);
            }
        } catch {
            // next try
        }
    }, 15000);

    return () => {
        clearInterval(locationTimer);
        charts.forEach((x) => x?.destroy());
    };
}
