import { html, $, get, qs, num, dateTime, ago, accountLink, characterLink, errorToast, RARITY_CLASS } from '../core.js';
import { removeDialog } from '../inventoryview.js';
import { navigate } from '../app.js';

const OWNER_LINK = {
    character: (i) => characterLink(i.owner, i.ownerName),
    account: (i) => accountLink(i.owner, i.ownerName),
    guild: (i) => html`<a href="/guilds/${i.owner}">${i.ownerName ?? '#' + i.owner}</a>`,
};

export async function render (view, params, query)
{
    const uid = (query.get('uid') ?? '').trim();

    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    let data = null;

    const draw = () => {
        const live = data === null ? [] : data.instances.filter((i) => i.deleted === null);

        root.innerHTML = String(html`
            <div class="page">
                <div class="page-head">
                    <div><h1>Item trace</h1><div class="sub">Every item has a unique item id. The trace shows every copy of the item and its complete history (drops, trades, removals).</div></div>
                </div>
                <form class="filters" id="trace-form">
                    <input name="uid" class="mono" placeholder="Item id, e.g. 3f2c9a1e-…" value="${uid}" style="width:380px" required>
                    <button class="primary" type="submit">Trace</button>
                    <a href="/flags?rule=item_dupe" class="small">Duplicated items</a>
                </form>
                ${data === null ? '' : html`
                    ${data.instances.length === 0 && data.log.length === 0 ? html`<div class="error-box">No item with this id.</div>` : html`
                    ${live.length > 1 ? html`<div class="error-box" style="margin-bottom:14px"><b>Duplicated item:</b> this item id exists ${live.length} times. Normally an item id exists only once.
                        Remove the copies that should not exist (usually the newer ones, compare with the history).</div>` : ''}
                    <div class="panel flush" style="margin-bottom:14px">
                        <h2>Copies <span class="muted small">${live.length} existing, ${data.instances.length - live.length} removed</span></h2>
                        <div class="table-wrap"><table>
                            <thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th>Owner</th><th>Container</th><th>Created</th><th>Origin</th><th>Status</th><th></th></tr></thead>
                            <tbody>
                                ${data.instances.map((i) => html`<tr class="${i.deleted ? 'reviewed-ok' : (live.length > 1 ? 'flagged' : '')}">
                                    <td class="muted">${i.id}</td>
                                    <td><span class="${RARITY_CLASS[i.rarity] ?? ''}">${i.name}</span>${i.level ? html` <span class="muted small">lvl ${i.level}</span>` : ''}</td>
                                    <td class="num">${num(i.quantity)}</td>
                                    <td class="nowrap">${(OWNER_LINK[i.ownerType] ?? (() => '-'))(i)} <span class="muted small">${i.ownerType}</span></td>
                                    <td>${i.container}</td>
                                    <td class="nowrap small">${dateTime(i.created)}</td>
                                    <td class="small">${i.origin ?? '-'}${i.originRef ? html` <span class="muted">${i.originRef}</span>` : ''}</td>
                                    <td class="small">${i.deleted ? html`removed ${ago(i.deleted)} by ${i.deletedByName ?? '?'}<div class="muted">${i.deletedReason ?? ''}</div>` : html`<span class="badge ok">exists</span>`}</td>
                                    <td>${i.deleted ? '' : html`<button class="small danger" data-remove="${i.id}">Remove</button>`}</td>
                                </tr>`)}
                            </tbody>
                        </table></div>
                    </div>
                    <div class="grid cols-2">
                        <div class="panel flush">
                            <h2>History</h2>
                            <div class="table-wrap"><table>
                                <thead><tr><th>Time</th><th></th><th class="num">Qty</th><th>Source</th><th>Character</th><th>Partner</th></tr></thead>
                                <tbody>
                                    ${data.log.map((l) => html`<tr>
                                        <td class="nowrap small">${dateTime(l.time)}</td>
                                        <td>${l.sign > 0 ? html`<span class="ok">+ received</span>` : html`<span class="bad">− gave away</span>`}</td>
                                        <td class="num">${l.quantity}</td>
                                        <td>${l.source}</td>
                                        <td>${characterLink(l.character, l.characterName)}${l.accountName ? html` <span class="muted small">(${l.accountName})</span>` : ''}</td>
                                        <td>${characterLink(l.partner, l.partnerName)}</td>
                                    </tr>`)}
                                    ${data.log.length === 0 ? html`<tr class="empty-row"><td colspan="6">No history: the item appeared without any record (suspicious)</td></tr>` : ''}
                                </tbody>
                            </table></div>
                        </div>
                        <div class="panel flush">
                            <h2>Trades</h2>
                            <table>
                                <tbody>
                                    ${data.trades.map((t) => html`<tr>
                                        <td class="muted">#${t.id}</td>
                                        <td class="small nowrap">${dateTime(t.time)}</td>
                                        <td>${characterLink(t.side === 1 ? t.character1 : t.character2, t.side === 1 ? t.name1 : t.name2)} → ${characterLink(t.side === 1 ? t.character2 : t.character1, t.side === 1 ? t.name2 : t.name1)}</td>
                                        <td><span class="badge ${['open', 'completed', 'cancelled'][t.state]}">${['open', 'completed', 'cancelled'][t.state]}</span></td>
                                    </tr>`)}
                                    ${data.trades.length === 0 ? html`<tr class="empty-row"><td>Never traded</td></tr>` : ''}
                                </tbody>
                            </table>
                        </div>
                    </div>`}`}
            </div>`);
    };

    const load = async () => {
        data = uid === '' ? null : await get('/api/items/trace' + qs({ uid }));
        draw();
    };

    root.addEventListener('submit', (event) => {
        event.preventDefault();
        navigate('/items' + qs({ uid: event.target.uid.value.trim() }), true);
    });

    root.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-remove]');
        if (button) {
            const item = data.instances.find((i) => i.id === Number(button.dataset.remove));
            await removeDialog({ ...item, copies: data.instances.filter((i) => i.deleted === null).length }, load).catch(errorToast);
        }
    });

    await load();
}
