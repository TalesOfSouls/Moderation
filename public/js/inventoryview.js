/**
 * Inventories (character backpack, account stash, guild vault): list, give and remove items
 */
import { html, $, get, post, qs, num, dateTime, ago, dialog, toast, errorToast, RARITY_CLASS, esc, ApiError } from './core.js';

const CONTAINER = { backpack: 'Backpack', stash: 'Account stash', vault: 'Guild vault' };

let metaCache = null;

async function meta ()
{
    metaCache = metaCache ?? await get('/api/meta');

    return metaCache;
}

/**
 * @param {HTMLElement} box
 * @param {{type:'character'|'account'|'guild', id:number, title?:string}} owner
 */
export async function renderInventory (target, owner)
{
    // own element, so the listeners disappear together with it
    const box = document.createElement('div');
    target.replaceChildren(box);

    let showDeleted = false;
    let filter = '';
    let data = null;

    const load = async () => {
        data = await get('/api/inventory' + qs({ type: owner.type, id: owner.id, deleted: showDeleted ? '1' : '' }));
        draw();
    };

    const draw = () => {
        const list = data.items.filter((i) => filter === '' || (i.name + ' ' + i.uid).toLowerCase().includes(filter));
        const dupes = data.items.filter((i) => i.copies > 1 && i.deleted === null).length;
        const total = data.items.filter((i) => i.deleted === null).length;

        box.innerHTML = String(html`
            <div class="panel flush">
                <div class="panel-head" style="padding:12px 14px 0">
                    <h2>${owner.title ?? CONTAINER[{ character: 'backpack', account: 'stash', guild: 'vault' }[owner.type]]} <span class="muted small">${data.owner.name} · ${num(total)} item stack(s)</span>
                        ${dupes > 0 ? html` <span class="badge sev-3">${dupes} duplicated</span>` : ''}</h2>
                    <div class="row">
                        <input type="search" data-filter placeholder="Filter name or item id…" value="${filter}" style="width:190px">
                        <label class="small muted"><input type="checkbox" data-deleted ${showDeleted ? 'checked' : ''}> removed items</label>
                        <button class="primary small" data-give>Give item</button>
                    </div>
                </div>
                <div class="table-wrap scroll"><table>
                    <thead><tr><th>Item</th><th class="num">Qty</th><th>Type</th><th>Item id</th><th>Obtained</th><th>Origin</th><th></th></tr></thead>
                    <tbody>
                        ${list.map((i) => html`<tr class="${i.deleted ? 'reviewed-ok' : ''} ${i.copies > 1 && !i.deleted ? 'flagged' : ''}">
                            <td><span class="${RARITY_CLASS[i.rarity] ?? ''}">${i.name}</span>${i.level ? html` <span class="muted small">lvl ${i.level}</span>` : ''}
                                ${i.copies > 1 && !i.deleted ? html` <span class="badge sev-3" title="This item id exists ${i.copies} times">duplicate ×${i.copies}</span>` : ''}
                                ${!i.hasOrigin && !i.deleted ? html` <span class="badge sev-2" title="There is no record how this item was obtained">no origin</span>` : ''}
                                ${i.hasOrigin && i.quantity > (i.added ?? 0) && !i.deleted ? html` <span class="badge sev-3" title="Only ${i.added} were ever added to this stack">grown stack (${i.added} added)</span>` : ''}
                                ${i.deleted ? html`<div class="small muted">removed by ${i.deletedByName ?? '?'} ${ago(i.deleted)}: ${i.deletedReason ?? ''}</div>` : ''}</td>
                            <td class="num">${num(i.quantity)}</td>
                            <td class="small muted">${i.equipmentType ?? i.typeName ?? (i.individual ? 'Equipment' : 'Item')}</td>
                            <td class="mono"><a href="/items?uid=${i.uid}" title="${i.uid}">${i.uid.slice(0, 8)}…</a></td>
                            <td class="small nowrap" title="${dateTime(i.created)}">${ago(i.created)}</td>
                            <td class="small">${i.origin ?? '-'}</td>
                            <td class="nowrap">${i.deleted ? '' : html`<button class="small danger" data-remove="${i.id}">Remove</button>`}</td>
                        </tr>`)}
                        ${list.length === 0 ? html`<tr class="empty-row"><td colspan="7">No items</td></tr>` : ''}
                    </tbody>
                </table></div>
            </div>`);
    };

    box.addEventListener('input', (event) => {
        if (event.target.matches('[data-filter]')) {
            filter = event.target.value.trim().toLowerCase();
            const position = event.target.selectionStart;
            draw();
            const input = $('[data-filter]', box);
            input.focus();
            input.setSelectionRange(position, position);
        }
    });

    box.addEventListener('change', (event) => {
        if (event.target.matches('[data-deleted]')) {
            showDeleted = event.target.checked;
            load().catch(errorToast);
        }
    });

    box.addEventListener('click', async (event) => {
        const removeButton = event.target.closest('[data-remove]');
        if (removeButton) {
            const item = data.items.find((i) => i.id === Number(removeButton.dataset.remove));
            await removeDialog(item, load);

            return;
        }

        if (event.target.closest('[data-give]')) {
            await giveDialog(owner, data.owner.name, load);
        }
    });

    await load();
}

export async function removeDialog (item, done)
{
    await dialog({
        title: 'Remove ' + item.name,
        text: 'The item is removed from ' + (item.ownerName ?? 'the owner') + '. It stays in the history (item trace) and the action is logged.',
        body: html`
            <div class="info-box mono small">${item.uid}</div>
            ${item.quantity > 1 ? html`<label>Quantity (of ${item.quantity})<input type="number" name="quantity" min="1" max="${item.quantity}" value="${item.quantity}" required></label>` : ''}
            <label>Reason <textarea name="reason" maxlength="500" required>${item.copies > 1 ? 'Duplicated item' : ''}</textarea></label>`,
        submit: 'Remove',
        danger: true,
        onSubmit: async (values) => {
            const result = await post('/api/items/' + item.id + '/remove', { quantity: Number(values.quantity ?? item.quantity), reason: values.reason });
            toast(result.message);
            await done();
        },
    });
}

export async function giveDialog (owner, ownerName, done)
{
    const m = await meta();
    let templates = [];

    await dialog({
        title: 'Give item to ' + ownerName,
        text: 'Creates a new item with a new item id. Use it e.g. when a quest or raid item was lost because of a bug.',
        body: html`
            <div class="toggle" data-kind>
                <button type="button" data-kind-value="item" class="active">Item</button>
                <button type="button" data-kind-value="equipment">Equipment</button>
            </div>
            <input type="hidden" name="kind" value="item">
            <div data-kind-box="item" class="stack">
                <label>Item <input name="itemSearch" list="item-templates" placeholder="Type to search…" autocomplete="off"></label>
                <datalist id="item-templates"></datalist>
                <input type="hidden" name="item">
                <label>Quantity <input type="number" name="quantity" min="1" max="9999" value="1"></label>
            </div>
            <div data-kind-box="equipment" class="stack" hidden>
                <label>Type <select name="equipment.type"><option value="">Select…</option>${m.equipmentTypes.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></label>
                <label>Name <input name="equipment.name" maxlength="100" placeholder="e.g. Ashen Crown of the Fallen"></label>
                <div class="row">
                    <label style="flex:1">Rarity <select name="equipment.rarity">${m.rarities.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select></label>
                    <label style="flex:1">Level <input type="number" name="equipment.level" min="1" max="100" value="60"></label>
                </div>
            </div>
            <label>Reason <textarea name="reason" maxlength="500" required placeholder="e.g. raid item did not drop (bug #123)"></textarea></label>`,
        submit: 'Give item',
        onOpen: (form) => {
            const search = form.querySelector('[name=itemSearch]');
            let timer = null;

            search.addEventListener('input', () => {
                const match = templates.find((t) => t.name === search.value);
                form.item.value = match ? match.id : '';
                clearTimeout(timer);
                timer = setTimeout(async () => {
                    templates = await get('/api/items/templates' + qs({ q: search.value.trim() }));
                    form.querySelector('#item-templates').innerHTML = templates.map((t) => '<option value="' + esc(t.name) + '">' + esc(t.type ?? '') + '</option>').join('');
                    const exact = templates.find((t) => t.name === search.value);
                    form.item.value = exact ? exact.id : form.item.value;
                }, 200);
            });

            form.querySelector('[data-kind]').addEventListener('click', (event) => {
                const button = event.target.closest('[data-kind-value]');
                if (!button) {
                    return;
                }

                form.kind.value = button.dataset.kindValue;
                form.querySelectorAll('[data-kind-value]').forEach((b) => b.classList.toggle('active', b === button));
                form.querySelectorAll('[data-kind-box]').forEach((b) => {
                    b.hidden = b.dataset.kindBox !== button.dataset.kindValue;
                });
            });
        },
        onSubmit: async (values) => {
            if (values.kind === 'item' && !values.item) {
                throw new ApiError(422, 'Please select an item from the list', { itemSearch: 'Select an item from the suggestions' });
            }

            const result = await post('/api/items/give', {
                ownerType: owner.type,
                owner: owner.id,
                kind: values.kind,
                item: Number(values.item) || null,
                quantity: Number(values.quantity) || 1,
                equipment: { type: Number(values['equipment.type']), name: values['equipment.name'], rarity: Number(values['equipment.rarity']), level: Number(values['equipment.level']) },
                reason: values.reason,
            });
            toast(result.message);
            await done();
        },
    });
}
