import { html, $, get, num, compact, duration, accountLink, severityBadge, sortable, sortRows, sortHeader } from '../core.js';
import { navigate } from '../app.js';

const COLUMNS = [
    { key: 'goldPerMinute', label: 'Gold / min', format: (v) => num(v, 1), limit: 'goldPerMinute' },
    { key: 'xpPerMinute', label: 'XP / min', format: (v) => num(v), limit: 'xpPerMinute' },
    { key: 'playtime5', label: 'Playtime 5 days', format: (v) => duration(v), limit: 'playtime5' },
    { key: 'matches', label: 'Matches', format: (v) => num(v) },
    { key: 'winRatio', label: 'Win/loss', format: (v, r) => (r.matches > 0 ? num(v, 2) : '-'), title: (r) => r.wins + ' wins / ' + r.losses + ' losses' },
    { key: 'avgDps', label: 'Avg DPS', format: (v) => num(v) },
    { key: 'peakDps', label: 'Peak DPS', format: (v) => num(v) },
    { key: 'peakDamage', label: 'Peak damage', format: (v) => compact(v), title: (r) => num(r.peakDamage) + ' damage in one encounter' },
    { key: 'avgHps', label: 'Avg HPS', format: (v) => num(v) },
    { key: 'peakHps', label: 'Peak HPS', format: (v) => num(v) },
    { key: 'peakHealing', label: 'Peak healing', format: (v) => compact(v), title: (r) => num(r.peakHealing) + ' healing in one encounter' },
    { key: 'maxApm', label: 'Max APM', format: (v) => num(v), limit: 'maxApm' },
];

export async function render (view, params, query)
{
    const days = parseInt(query.get('days') ?? '14', 10) || 14;
    const state = { key: query.get('sort') ?? 'goldPerMinute', dir: 'desc', filter: '', flagged: false };
    const data = await get('/api/rankings?days=' + days);

    // statistical outliers (mean + 3 standard deviations) are marked even below the configured limit
    const outlier = {};
    for (const c of COLUMNS) {
        const values = data.rows.map((r) => r[c.key]).filter((v) => v > 0);
        const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
        const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length));
        outlier[c.key] = mean + 3 * std;
    }

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div>
                    <h1>Rankings</h1>
                    <div class="sub">Per account (all characters together). Red = above the configured limit, yellow = statistical outlier (more than 3 standard deviations above the average).</div>
                </div>
            </div>
            <div class="filters">
                <div class="toggle" id="days">
                    ${[1, 5, 14, 30].map((d) => html`<button type="button" data-days="${d}" class="${d === days ? 'active' : ''}">${d === 1 ? '24 hours' : d + ' days'}</button>`)}
                </div>
                <input type="search" id="filter" placeholder="Filter accounts…">
                <label><input type="checkbox" id="flagged"> only accounts with open flags</label>
                <span class="small muted">Playtime always covers the last 5 days, all other columns the selected period.</span>
            </div>
            <div class="panel flush"><div class="table-wrap scroll tall" id="table"></div></div>
        </div>`);

    const table = $('#table', view);

    const draw = () => {
        let rows = sortRows(data.rows, state);
        if (state.filter !== '') {
            rows = rows.filter((r) => r.name.toLowerCase().includes(state.filter));
        }

        if (state.flagged) {
            rows = rows.filter((r) => r.flags > 0);
        }

        table.innerHTML = String(html`
            <table>
                <thead><tr>
                    <th>#</th>
                    ${sortHeader('Account', 'name', state)}
                    ${sortHeader('Flags', 'flags', state, 'num')}
                    ${COLUMNS.map((c) => sortHeader(c.label, c.key, state, 'num'))}
                </tr></thead>
                <tbody>
                    ${rows.map((r, i) => html`<tr>
                        <td class="muted">${i + 1}</td>
                        <td class="nowrap">${accountLink(r.account, r.name)} ${r.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}</td>
                        <td class="num">${r.flags > 0 ? html`<a href="/flags?account=${r.account}">${severityBadge(r.severity)} ${r.flags}</a>` : html`<span class="muted">-</span>`}</td>
                        ${COLUMNS.map((c) => {
                            const value = r[c.key];
                            const limit = c.limit ? data.limits[c.limit] : null;
                            const cls = limit !== null && value > limit ? 'hot' : (value > outlier[c.key] && value > 0 ? 'warm' : '');

                            return html`<td class="num ${cls}" title="${c.title ? c.title(r) : ''}">${c.format(value, r)}</td>`;
                        })}
                    </tr>`)}
                    ${rows.length === 0 ? html`<tr class="empty-row"><td colspan="${COLUMNS.length + 3}">No activity in this period</td></tr>` : ''}
                </tbody>
            </table>`);
    };

    sortable(table, state, draw);

    $('#days', view).addEventListener('click', (event) => {
        const button = event.target.closest('[data-days]');
        if (button) {
            navigate('/rankings?days=' + button.dataset.days, true);
        }
    });

    $('#filter', view).addEventListener('input', (event) => {
        state.filter = event.target.value.trim().toLowerCase();
        draw();
    });

    $('#flagged', view).addEventListener('change', (event) => {
        state.flagged = event.target.checked;
        draw();
    });

    draw();
}
