import { html, $, get, qs, live, dateTime, ago, num, accountLink, characterLink, errorToast, RARITY_CLASS, toast } from '../core.js';

export async function render (view, params, query)
{
    const filters = {
        state: query.get('state') ?? '',
        q: query.get('q') ?? '',
        minGold: query.get('minGold') ?? '',
        account: query.get('account') ?? '',
        character: query.get('character') ?? '',
    };

    let rows = [];
    let oneSided = query.get('oneSided') === '1';

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div><h1>Trades</h1><div class="sub">Open trades update live when they are completed or cancelled.</div></div>
            </div>
            <form class="filters" id="filters">
                <div class="toggle" id="state">
                    ${[['', 'All'], ['0', 'Open'], ['1', 'Completed'], ['2', 'Cancelled']].map(([v, l]) => html`<button type="button" data-state="${v}" class="${filters.state === v ? 'active' : ''}">${l}</button>`)}
                </div>
                <input type="search" name="q" placeholder="Character…" value="${filters.q}">
                <label>Min. gold <input type="number" name="minGold" min="0" step="100" value="${filters.minGold}" style="width:100px"></label>
                <label><input type="checkbox" id="one-sided" ${oneSided ? 'checked' : ''}> only one-sided (gold for nothing)</label>
                ${filters.account ? html`<span class="badge">Account #${filters.account} <a href="/trades">×</a></span>` : ''}
                ${filters.character ? html`<span class="badge">Character #${filters.character} <a href="/trades">×</a></span>` : ''}
                <span class="small muted" id="count"></span>
            </form>
            <div class="panel flush">
                <div class="table-wrap scroll tall">
                    <table class="feed">
                        <thead><tr><th>#</th><th>State</th><th>Time</th><th>Player 1 gives</th><th></th><th>Player 2 gives</th><th>Where</th></tr></thead>
                        <tbody id="rows"></tbody>
                    </table>
                    <div style="padding:10px;text-align:center"><button id="older" class="small">Load older trades</button></div>
                </div>
            </div>
        </div>`);

    const tbody = $('#rows', view);

    const side = (character, name, account, accountName, gold, items) => html`
        <div class="nowrap">${characterLink(character, name)} <span class="muted small">(${accountLink(account, accountName)})</span></div>
        <ul class="item-list small">
            ${gold > 0 ? html`<li class="warn">${num(gold)} gold</li>` : ''}
            ${items.map((i) => html`<li class="${RARITY_CLASS[i.rarity] ?? ''}">${i.quantity}× ${i.name}</li>`)}
            ${gold === 0 && items.length === 0 ? html`<li class="muted">nothing</li>` : ''}
        </ul>`;

    const row = (t, isNew = false) => html`
        <tr data-id="${t.id}" class="${t.oneSided ? 'flagged' : ''} ${isNew ? 'new' : ''}">
            <td class="muted">${t.id}</td>
            <td><span class="badge ${t.stateName}">${t.stateName}</span>${t.oneSided ? html`<div><span class="badge sev-3" title="Large amount of gold for nothing">one-sided</span></div>` : ''}</td>
            <td class="time" title="started ${dateTime(t.created)}">${dateTime(t.updated)}<br>${ago(t.updated)}</td>
            <td>${side(t.character1, t.name1, t.account1, t.accountName1, t.gold1, t.items1)}</td>
            <td class="muted">⇄</td>
            <td>${side(t.character2, t.name2, t.account2, t.accountName2, t.gold2, t.items2)}</td>
            <td class="small nowrap">${t.zoneName ?? '-'}<br><span class="muted">${t.serverName ?? ''}</span></td>
        </tr>`;

    const visible = () => rows.filter((t) => !oneSided || t.oneSided);

    const draw = () => {
        const list = visible();
        tbody.innerHTML = list.length === 0 ? '<tr class="empty-row"><td colspan="7">No trades</td></tr>' : list.map((t) => String(row(t))).join('');
        $('#count', view).textContent = num(list.length) + ' trades';
    };

    const load = async () => {
        rows = await get('/api/trades' + qs({ ...filters, limit: 300 }));
        draw();
    };

    const update = () => {
        history.replaceState(null, '', '/trades' + qs({ ...filters, oneSided: oneSided ? '1' : '' }));
        load().catch(errorToast);
    };

    $('#state', view).addEventListener('click', (event) => {
        const button = event.target.closest('[data-state]');
        if (button) {
            filters.state = button.dataset.state;
            $('#state', view).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
            update();
        }
    });

    $('#filters', view).addEventListener('change', (event) => {
        if (event.target.id === 'one-sided') {
            oneSided = event.target.checked;
            history.replaceState(null, '', '/trades' + qs({ ...filters, oneSided: oneSided ? '1' : '' }));
            draw();

            return;
        }

        if (event.target.name) {
            filters[event.target.name] = event.target.value.trim();
            update();
        }
    });

    $('#filters', view).addEventListener('submit', (event) => event.preventDefault());

    $('#older', view).addEventListener('click', async () => {
        const before = rows.length > 0 ? Math.min(...rows.map((r) => r.id)) : undefined;
        const older = await get('/api/trades' + qs({ ...filters, before, limit: 300 }));
        rows = [...rows, ...older];
        draw();
        if (older.length === 0) {
            toast('No older trades', 'info');
        }
    });

    await load();

    return live.on('trades', (list) => {
        let changed = false;
        for (const t of list) {
            const matches = (filters.state === '' || String(t.state) === filters.state)
                && (filters.account === '' || String(t.account1) === filters.account || String(t.account2) === filters.account)
                && (filters.character === '' || String(t.character1) === filters.character || String(t.character2) === filters.character)
                && (filters.q === '' || (t.name1 + ' ' + t.name2).toLowerCase().includes(filters.q.toLowerCase()))
                && (filters.minGold === '' || Math.max(t.gold1, t.gold2) >= Number(filters.minGold));

            const index = rows.findIndex((r) => r.id === t.id);
            if (index >= 0) {
                if (matches) {
                    rows[index] = t;
                } else {
                    rows.splice(index, 1);
                }

                const tr = tbody.querySelector('tr[data-id="' + t.id + '"]');
                if (tr !== null) {
                    if (matches && (!oneSided || t.oneSided)) {
                        tr.outerHTML = String(row(t, true));
                    } else {
                        tr.remove();
                    }
                }
            } else if (matches) {
                rows.unshift(t);
                changed = true;
            }
        }

        if (changed) {
            draw();
            tbody.querySelectorAll('tr').forEach((tr) => {
                if (list.some((t) => String(t.id) === tr.dataset.id)) {
                    tr.classList.add('new');
                }
            });
        }
    });
}
