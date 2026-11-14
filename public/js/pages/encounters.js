import { html, $, get, qs, num, dateTime, duration, ago, errorToast, toast } from '../core.js';
import { navigate } from '../app.js';

export const TYPES = { '': 'All', dungeon: 'Dungeons', raid: 'Raids', worldboss: 'World bosses', pvp: 'PvP matches' };
export const TYPE_NAME = { dungeon: 'Dungeon', raid: 'Raid', worldboss: 'World boss', pvp: 'PvP' };

export function result (e)
{
    if (e.type === 'pvp') {
        return e.winner ? html`Team ${e.winner} won <span class="muted">${e.score1 ?? 0} : ${e.score2 ?? 0}</span>` : html`<span class="muted">draw</span>`;
    }

    if (e.bosses > 0) {
        return html`<span class="${e.bossesKilled === e.bosses ? 'ok' : (e.bossesKilled > 0 ? 'warn' : 'bad')}">${e.bossesKilled} / ${e.bosses} bosses</span>`;
    }

    return e.success ? html`<span class="ok">success</span>` : html`<span class="bad">failed</span>`;
}

export async function render (view, params, query)
{
    const state = {
        type: query.get('type') ?? '',
        instance: query.get('instance') ?? '',
        player: query.get('player') ?? '',
        from: query.get('from') ?? '',
        to: query.get('to') ?? '',
        short: query.get('short') ?? '',
        account: query.get('account') ?? '',
    };

    const meta = await get('/api/meta');
    const instances = meta.instances ?? [];
    let rows = [];

    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    root.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div><h1>Instances & matches</h1><div class="sub">Dungeons, raids, world boss fights and PvP matches, newest first. Click on one to see everything that happened in it.</div></div>
            </div>
            <form class="filters" id="filters">
                <div class="toggle" id="types">
                    ${Object.entries(TYPES).map(([k, l]) => html`<button type="button" data-type="${k}" class="${state.type === k ? 'active' : ''}">${l}</button>`)}
                </div>
                <select name="instance">
                    <option value="">All instances</option>
                    ${instances.filter((i) => state.type === '' || i.type === state.type).map((i) => html`<option value="${i.id}" ${state.instance === String(i.id) ? 'selected' : ''}>${i.name}${i.size ? ' (' + i.size + ')' : ''}</option>`)}
                </select>
                <input type="search" name="player" placeholder="Character or account…" value="${state.player}">
                <label>From <input type="date" name="from" value="${state.from}"></label>
                <label>To <input type="date" name="to" value="${state.to}"></label>
                ${state.type === 'pvp' || state.type === '' ? html`<label><input type="checkbox" name="short" ${state.short === '1' ? 'checked' : ''}> only suspiciously short PvP matches</label>` : ''}
                ${state.account ? html`<span class="badge">Account #${state.account} <a href="/encounters">×</a></span>` : ''}
                <span class="small muted" id="count"></span>
            </form>
            <div class="panel flush">
                <div class="table-wrap scroll tall">
                    <table>
                        <thead><tr><th>Start</th><th>Type</th><th>Instance</th><th>Mode</th><th class="num">Duration</th><th>Result</th><th class="num">Players</th><th class="num">Chat</th><th class="num">Drops</th><th class="num">Max APM</th><th>Flagged players</th></tr></thead>
                        <tbody id="rows"></tbody>
                    </table>
                    <div style="padding:10px;text-align:center"><button id="more" class="small">Load older</button></div>
                </div>
            </div>
        </div>`);

    const row = (e) => html`
        <tr class="clickable" data-encounter="${e.id}">
            <td class="nowrap"><a href="/encounters/${e.id}">${dateTime(e.start)}</a><div class="small muted">${ago(e.start)}</div></td>
            <td><span class="badge type-${e.type}">${TYPE_NAME[e.type] ?? e.type}</span></td>
            <td>${e.instanceName ?? '-'}</td>
            <td class="small">${e.mode ?? e.difficulty ?? ''}</td>
            <td class="num ${e.type === 'pvp' && e.duration < meta.shortMatchSeconds ? 'hot' : ''}">${duration(e.duration)}</td>
            <td class="nowrap">${result(e)}</td>
            <td class="num">${e.members}</td>
            <td class="num">${e.chat || html`<span class="muted">-</span>`}</td>
            <td class="num">${e.drops || html`<span class="muted">-</span>`}</td>
            <td class="num ${e.maxApm > meta.maxApm ? 'hot' : ''}">${num(e.maxApm)}</td>
            <td>${e.flagged > 0 ? html`<span class="badge sev-2">${e.flagged} with open flags</span>` : html`<span class="muted">-</span>`}</td>
        </tr>`;

    const draw = () => {
        $('#rows', root).innerHTML = rows.length === 0 ? '<tr class="empty-row"><td colspan="11">Nothing found</td></tr>' : rows.map((e) => String(row(e))).join('');
        $('#count', root).textContent = num(rows.length) + (rows.length >= 200 ? '+' : '') + ' shown';
    };

    const load = async (more = false) => {
        const list = await get('/api/encounters' + qs({ ...state, before: more && rows.length > 0 ? rows.at(-1).start : '', limit: 200 }));
        rows = more ? [...rows, ...list] : list;
        draw();
        if (more && list.length === 0) {
            toast('No older entries', 'info');
        }
    };

    const update = () => navigate('/encounters' + qs(state), true);

    $('#types', root).addEventListener('click', (event) => {
        const button = event.target.closest('[data-type]');
        if (button) {
            state.type = button.dataset.type;
            state.instance = '';
            update();
        }
    });

    $('#filters', root).addEventListener('change', (event) => {
        const el = event.target;
        if (!el.name) {
            return;
        }

        state[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value.trim();
        update();
    });

    $('#filters', root).addEventListener('submit', (event) => event.preventDefault());

    $('#rows', root).addEventListener('click', (event) => {
        const tr = event.target.closest('[data-encounter]');
        if (tr && !event.target.closest('a')) {
            navigate('/encounters/' + tr.dataset.encounter);
        }
    });

    $('#more', root).addEventListener('click', () => load(true).catch(errorToast));

    await load();
}
