import { html, $, get, num, compact, ago, chart, live, severityBadge, accountLink, COLORS } from '../core.js';

let meta = null;

export async function render (view)
{
    meta = meta ?? await get('/api/meta');
    const charts = [];
    let timer = null;

    const load = async () => {
        const data = await get('/api/dashboard');
        draw(data);
    };

    const draw = (data) => {
        const s = data.status;
        const h = data.lastHour;

        view.innerHTML = String(html`
            <div class="page">
                <div class="page-head">
                    <div><h1>Dashboard</h1><div class="sub">Live overview of the game world</div></div>
                    <div class="actions"><a class="button" href="/flags">Review suspicious activity</a></div>
                </div>

                <div class="kpis">
                    <div class="kpi"><div class="label">Online players</div><div class="value">${num(s.online)}</div></div>
                    <div class="kpi ${s.highFlags > 0 ? 'alert' : ''}"><div class="label">Open flags</div><div class="value">${num(s.flags)}</div><div class="hint">${s.highFlags} high severity</div></div>
                    <div class="kpi ${s.unread > 0 ? 'warn' : ''}"><div class="label">Support requests</div><div class="value">${num(s.unread)}</div><div class="hint">unread</div></div>
                    <div class="kpi"><div class="label">Chat (1h)</div><div class="value">${num(h.chat)}</div><div class="hint">${h.flaggedChat} offensive</div></div>
                    <div class="kpi"><div class="label">Gold looted (1h)</div><div class="value">${compact(h.gold)}</div></div>
                    <div class="kpi"><div class="label">Item drops (1h)</div><div class="value">${num(h.drops)}</div></div>
                    <div class="kpi"><div class="label">Trades (1h)</div><div class="value">${num(h.trades)}</div><div class="hint">${s.openTrades} open right now</div></div>
                </div>

                <div class="grid side">
                    <div class="panel">
                        <div class="panel-head"><h2>Activity in the last 24 hours</h2></div>
                        <div class="chart-box tall"><canvas id="activity"></canvas></div>
                    </div>
                    <div class="panel flush">
                        <h2>Open flags per rule</h2>
                        <table>
                            <tbody>
                                ${data.rules.map((r) => html`<tr><td><a href="/flags?rule=${r.rule}">${meta.rules[r.rule]?.label ?? r.rule}</a></td><td>${severityBadge(r.severity)}</td><td class="num">${r.count}</td></tr>`)}
                                ${data.rules.length === 0 ? html`<tr class="empty-row"><td>No open flags</td></tr>` : ''}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="grid cols-2" style="margin-top:14px">
                    <div class="panel flush">
                        <h2>Most suspicious accounts</h2>
                        <div class="table-wrap">
                            <table>
                                <thead><tr><th>Account</th><th>Severity</th><th class="num">Flags</th><th>Rules</th></tr></thead>
                                <tbody>
                                    ${data.suspects.map((a) => html`<tr>
                                        <td>${accountLink(a.account, a.name)} ${a.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}</td>
                                        <td>${severityBadge(a.severity)}</td>
                                        <td class="num">${a.flags}</td>
                                        <td class="small muted">${a.rules.map((r) => meta.rules[r]?.label ?? r).join(', ')}</td>
                                    </tr>`)}
                                    ${data.suspects.length === 0 ? html`<tr class="empty-row"><td colspan="4">Nothing suspicious right now</td></tr>` : ''}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="panel flush">
                        <h2>Latest moderation actions</h2>
                        <table>
                            <tbody>
                                ${data.recentActions.map((a) => html`<tr>
                                    <td class="nowrap muted small">${ago(a.time)}</td>
                                    <td>${a.moderatorName ?? 'System'}</td>
                                    <td><span class="badge">${a.type.replace('_', ' ')}</span></td>
                                    <td>${a.account ? accountLink(a.account, a.accountName) : html`<span class="muted">-</span>`}</td>
                                </tr>`)}
                                ${data.recentActions.length === 0 ? html`<tr class="empty-row"><td>No actions yet</td></tr>` : ''}
                            </tbody>
                        </table>
                        <div style="padding:8px 14px"><a href="/log" class="small">Full moderation log</a></div>
                    </div>
                </div>
            </div>`);

        charts.forEach((c) => c?.destroy());
        charts.length = 0;
        charts.push(chart($('#activity', view), {
            type: 'bar',
            data: {
                labels: data.hours.map((x) => x.label),
                datasets: [
                    { type: 'line', label: 'Gold looted', data: data.hours.map((x) => x.gold), yAxisID: 'gold', borderColor: COLORS[1], backgroundColor: COLORS[1], tension: 0.3, pointRadius: 0 },
                    { label: 'Chat messages', data: data.hours.map((x) => x.chat), backgroundColor: COLORS[0] },
                    { label: 'Item drops', data: data.hours.map((x) => x.drops), backgroundColor: COLORS[2] },
                    { label: 'Trades', data: data.hours.map((x) => x.trades), backgroundColor: COLORS[4] },
                ],
            },
            options: {
                interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'count' } }, gold: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'gold' } } },
            },
        }));
    };

    await load();
    timer = setInterval(() => load().catch(() => {}), 30000);
    const off = live.on('flags', () => load().catch(() => {}));

    return () => {
        clearInterval(timer);
        off();
        charts.forEach((c) => c?.destroy());
    };
}
