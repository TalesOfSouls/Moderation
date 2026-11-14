import { html, $, get, qs, live, clock, dateTime, num, accountLink, characterLink, errorToast, RARITY_CLASS, toast } from '../core.js';

const MAX_ROWS = 800;

export async function render (view, params, query)
{
    const meta = await get('/api/meta');
    const filters = {
        type: query.get('type') ?? '',
        zone: query.get('zone') ?? '',
        minRarity: query.get('minRarity') ?? '',
        minGold: query.get('minGold') ?? '',
        source: query.get('source') ?? '',
        account: query.get('account') ?? '',
        character: query.get('character') ?? '',
    };

    let rows = [];
    let paused = false;

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div><h1>Live drops</h1><div class="sub">Gold and items that players receive from monsters, quests and vendors: who got what, where and from whom.</div></div>
                <div class="actions"><button id="pause">Pause</button></div>
            </div>
            <form class="filters" id="filters">
                <select name="type">
                    <option value="">Gold and items</option>
                    <option value="gold" ${filters.type === 'gold' ? 'selected' : ''}>Only gold</option>
                    <option value="item" ${filters.type === 'item' ? 'selected' : ''}>Only items</option>
                </select>
                <select name="source">
                    <option value="">Loot, quests, vendors</option>
                    ${['loot', 'quest', 'vendor', 'trade'].map((s) => html`<option value="${s}" ${filters.source === s ? 'selected' : ''}>${s}</option>`)}
                </select>
                <select name="zone">
                    <option value="">All zones</option>
                    ${meta.zones.map((z) => html`<option value="${z.id}" ${filters.zone === String(z.id) ? 'selected' : ''}>${z.name}</option>`)}
                </select>
                <select name="minRarity">
                    <option value="">Any rarity</option>
                    ${meta.rarities.slice(1).map((r) => html`<option value="${r.id}" ${filters.minRarity === String(r.id) ? 'selected' : ''}>${r.name} or better</option>`)}
                </select>
                <label>Min. gold <input type="number" name="minGold" min="0" step="10" value="${filters.minGold}" style="width:90px"></label>
                ${filters.account ? html`<span class="badge">Account #${filters.account} <a href="/drops">×</a></span>` : ''}
                ${filters.character ? html`<span class="badge">Character #${filters.character} <a href="/drops">×</a></span>` : ''}
            </form>
            <div class="grid side">
                <div class="panel flush">
                    <div class="table-wrap scroll tall">
                        <table class="feed">
                            <thead><tr><th>Time</th><th>Drop</th><th>Source</th><th>Character</th><th>Account</th><th>Where</th></tr></thead>
                            <tbody id="rows"></tbody>
                        </table>
                        <div style="padding:10px;text-align:center"><button id="older" class="small">Load older drops</button></div>
                    </div>
                </div>
                <div class="panel flush">
                    <h2>Top receivers <span class="muted small">(last 10 minutes in this list)</span></h2>
                    <div id="top"></div>
                </div>
            </div>
        </div>`);

    const tbody = $('#rows', view);

    const row = (d, isNew = false) => html`
        <tr class="${isNew ? 'new' : ''}">
            <td class="time" title="${dateTime(d.time)}">${clock(d.time)}</td>
            <td class="nowrap">${d.type === 'gold'
                ? html`<b class="warn">${num(d.amount)} gold</b>`
                : html`<span class="${RARITY_CLASS[d.rarity] ?? ''}">${d.amount > 1 ? d.amount + '× ' : ''}${d.itemName}</span>${d.itemLevel ? html` <span class="muted small">ilvl ${d.itemLevel}</span>` : ''}`}</td>
            <td class="small">${d.source}${d.mobName ? html` · <span class="muted">${d.mobName}</span>` : ''}${d.partnerName ? html` · from ${characterLink(d.partner, d.partnerName)}` : ''}</td>
            <td class="nowrap">${characterLink(d.character, d.characterName)}</td>
            <td class="nowrap">${accountLink(d.account, d.accountName)}</td>
            <td class="small nowrap">${d.zoneName ?? '-'} ${d.x !== null && d.x !== undefined ? html`<span class="muted mono">(${Math.round(d.x)}, ${Math.round(d.y)})</span>` : ''}<br><span class="muted">${d.serverName ?? ''}</span></td>
        </tr>`;

    const top = () => {
        const since = Date.now() / 1000 - 600;
        const per = new Map();
        for (const d of rows) {
            if (d.time < since) {
                continue;
            }

            const entry = per.get(d.account) ?? { account: d.account, name: d.accountName, gold: 0, items: 0 };
            if (d.type === 'gold') {
                entry.gold += d.amount;
            } else {
                entry.items += 1;
            }

            per.set(d.account, entry);
        }

        const list = [...per.values()].sort((a, b) => b.gold - a.gold || b.items - a.items).slice(0, 15);
        $('#top', view).innerHTML = String(html`
            <table>
                <thead><tr><th>Account</th><th class="num">Gold</th><th class="num">Items</th></tr></thead>
                <tbody>
                    ${list.map((e) => html`<tr><td>${accountLink(e.account, e.name)}</td><td class="num">${num(e.gold)}</td><td class="num">${e.items}</td></tr>`)}
                    ${list.length === 0 ? html`<tr class="empty-row"><td colspan="3">No drops in the last 10 minutes</td></tr>` : ''}
                </tbody>
            </table>`);
    };

    const draw = () => {
        tbody.innerHTML = rows.length === 0 ? '<tr class="empty-row"><td colspan="6">No drops</td></tr>' : rows.map((d) => String(row(d))).join('');
        top();
    };

    const load = async () => {
        rows = await get('/api/drops' + qs({ ...filters, limit: 250 }));
        draw();
    };

    const matches = (d) => (filters.type === '' || d.type === filters.type)
        && (filters.zone === '' || String(d.zone) === filters.zone)
        && (filters.account === '' || String(d.account) === filters.account)
        && (filters.character === '' || String(d.character) === filters.character)
        && (filters.source === '' ? ['loot', 'quest', 'vendor'].includes(d.source) : d.source === filters.source)
        && (filters.minRarity === '' || (d.type === 'item' && d.rarity >= Number(filters.minRarity)))
        && (filters.minGold === '' || (d.type === 'gold' && d.amount >= Number(filters.minGold)));

    $('#filters', view).addEventListener('change', (event) => {
        filters[event.target.name] = event.target.value;
        history.replaceState(null, '', '/drops' + qs(filters));
        load().catch(errorToast);
    });

    $('#filters', view).addEventListener('submit', (event) => event.preventDefault());

    $('#pause', view).addEventListener('click', (event) => {
        paused = !paused;
        event.currentTarget.textContent = paused ? 'Resume' : 'Pause';
        if (!paused) {
            load().catch(errorToast);
        }
    });

    $('#older', view).addEventListener('click', async () => {
        const before = rows.length > 0 ? Math.min(...rows.map((r) => r.time)) : undefined;
        const older = await get('/api/drops' + qs({ ...filters, before, limit: 250 }));
        rows = [...rows, ...older];
        tbody.insertAdjacentHTML('beforeend', older.map((d) => String(row(d))).join(''));
        if (older.length === 0) {
            toast('No older drops', 'info');
        }
    });

    await load();

    const timer = setInterval(top, 15000);
    const off = live.on('drops', (list) => {
        if (paused) {
            return;
        }

        const fresh = list.filter(matches).sort((a, b) => b.time - a.time);
        if (fresh.length === 0) {
            return;
        }

        if (rows.length === 0) {
            tbody.innerHTML = '';
        }

        tbody.insertAdjacentHTML('afterbegin', fresh.map((d) => String(row(d, true))).join(''));
        rows = [...fresh, ...rows].slice(0, MAX_ROWS);
        while (tbody.children.length > MAX_ROWS) {
            tbody.lastElementChild.remove();
        }
    });

    return () => {
        off();
        clearInterval(timer);
    };
}
