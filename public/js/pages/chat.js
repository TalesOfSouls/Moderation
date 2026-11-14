import { html, $, get, post, qs, live, clock, dateTime, accountLink, characterLink, toast, errorToast, dialog, num } from '../core.js';
import { highlight } from '../flagview.js';

const MAX_ROWS = 600;

export async function render (view, params, query)
{
    const meta = await get('/api/meta');
    const filters = {
        channel: query.get('channel') ?? '',
        zone: query.get('zone') ?? '',
        q: query.get('q') ?? '',
        flagged: query.get('flagged') ?? '',
        account: query.get('account') ?? '',
        character: query.get('character') ?? '',
    };

    let rows = [];
    let paused = false;
    let buffered = [];

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div><h1>Live chat</h1><div class="sub">All chat channels of all servers, newest first. Offensive words of the <a href="/config#words">bad word list</a> are highlighted. Click a message to see the conversation around it.</div></div>
                <div class="actions">
                    <span class="paused-note" id="paused" hidden></span>
                    <button id="pause">Pause</button>
                </div>
            </div>
            <form class="filters" id="filters">
                <select name="channel">
                    <option value="">All channels</option>
                    ${Object.entries(meta.channels).map(([id, name]) => html`<option value="${id}" ${filters.channel === id ? 'selected' : ''}>${name}</option>`)}
                </select>
                <select name="zone">
                    <option value="">All zones</option>
                    ${meta.zones.map((z) => html`<option value="${z.id}" ${filters.zone === String(z.id) ? 'selected' : ''}>${z.name}</option>`)}
                </select>
                <input type="search" name="q" placeholder="Text or character…" value="${filters.q}">
                <label><input type="checkbox" name="flagged" ${filters.flagged === '1' ? 'checked' : ''}> only offensive</label>
                ${filters.account ? html`<span class="badge">Account #${filters.account} <a href="/chat">×</a></span>` : ''}
                ${filters.character ? html`<span class="badge">Character #${filters.character} <a href="/chat">×</a></span>` : ''}
                <span class="small muted" id="count"></span>
            </form>
            <div class="panel flush">
                <div class="table-wrap scroll tall">
                    <table class="feed">
                        <thead><tr><th>Time</th><th>Channel</th><th>Zone</th><th>Character</th><th>Account</th><th>Message</th><th></th></tr></thead>
                        <tbody id="rows"></tbody>
                    </table>
                    <div style="padding:10px;text-align:center"><button id="older" class="small">Load older messages</button></div>
                </div>
            </div>
        </div>`);

    const tbody = $('#rows', view);

    const row = (m, isNew = false) => html`
        <tr data-id="${m.id}" class="${m.badWords.length > 0 ? 'flagged' : ''} ${m.review === 1 ? 'reviewed-ok' : ''} ${isNew ? 'new' : ''}">
            <td class="time" title="${dateTime(m.time)}">${clock(m.time)}</td>
            <td><span class="channel c-${m.channel}">${m.channelName}</span></td>
            <td class="small muted nowrap">${m.zoneName ?? ''}<br>${m.serverName ?? ''}</td>
            <td class="nowrap">${characterLink(m.character, m.characterName)}</td>
            <td class="nowrap">${accountLink(m.account, m.accountName)}${m.muted > Date.now() / 1000 ? html` <span class="badge sev-2">muted</span>` : ''}</td>
            <td class="msg" data-chat-context="${m.id}" title="Show the conversation">${m.toCharacter ? html`<span class="muted">→ ${characterLink(m.toCharacter, m.toName)}:</span> ` : ''}${highlight(m.text, m.badWords)}</td>
            <td class="nowrap">
                ${m.review === 2 ? html`<span class="badge sev-3">offensive</span>` : ''}
                ${m.review === 1 ? html`<span class="badge ok">ok</span>` : ''}
                ${m.review !== 2 ? html`<button class="small danger" data-action="offensive" title="Mark as offensive">✗</button>` : ''}
                ${m.badWords.length > 0 && m.review !== 1 ? html`<button class="small success" data-action="ok" title="False alarm">✓</button>` : ''}
                <button class="small" data-action="mute" title="Mute the author">Mute</button>
            </td>
        </tr>`;

    const matches = (m) => (filters.channel === '' || String(m.channel) === filters.channel)
        && (filters.zone === '' || String(m.zone) === filters.zone)
        && (filters.account === '' || String(m.account) === filters.account)
        && (filters.character === '' || String(m.character) === filters.character || String(m.toCharacter) === filters.character)
        && (filters.flagged !== '1' || m.badWords.length > 0)
        && (filters.q === '' || (m.text + ' ' + m.characterName).toLowerCase().includes(filters.q.toLowerCase()));

    const draw = () => {
        tbody.innerHTML = rows.length === 0 ? '<tr class="empty-row"><td colspan="7">No messages</td></tr>' : rows.map((m) => String(row(m))).join('');
        $('#count', view).textContent = num(rows.length) + ' messages';
    };

    const load = async () => {
        rows = await get('/api/chat' + qs({ ...filters, limit: 200 }));
        draw();
    };

    const add = (list) => {
        const fresh = list.filter(matches).filter((m) => !rows.some((r) => r.id === m.id)).sort((a, b) => b.id - a.id);
        if (fresh.length === 0) {
            return;
        }

        if (rows.length === 0) {
            tbody.innerHTML = '';
        }

        tbody.insertAdjacentHTML('afterbegin', fresh.map((m) => String(row(m, true))).join(''));
        rows = [...fresh, ...rows];
        if (rows.length > MAX_ROWS) {
            rows = rows.slice(0, MAX_ROWS);
            while (tbody.children.length > MAX_ROWS) {
                tbody.lastElementChild.remove();
            }
        }

        $('#count', view).textContent = num(rows.length) + ' messages';
    };

    $('#filters', view).addEventListener('change', (event) => {
        const el = event.target;
        filters[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value;
        history.replaceState(null, '', '/chat' + qs(filters));
        load().catch(errorToast);
    });

    $('#filters', view).addEventListener('submit', (event) => event.preventDefault());

    let typing = null;
    $('[name=q]', view).addEventListener('input', (event) => {
        clearTimeout(typing);
        typing = setTimeout(() => {
            filters.q = event.target.value.trim();
            history.replaceState(null, '', '/chat' + qs(filters));
            load().catch(errorToast);
        }, 300);
    });

    $('#pause', view).addEventListener('click', (event) => {
        paused = !paused;
        event.currentTarget.textContent = paused ? 'Resume' : 'Pause';
        $('#paused', view).hidden = !paused;
        if (!paused) {
            add(buffered);
            buffered = [];
            $('#paused', view).textContent = '';
        }
    });

    $('#older', view).addEventListener('click', async () => {
        const before = rows.length > 0 ? Math.min(...rows.map((r) => r.id)) : undefined;
        const older = await get('/api/chat' + qs({ ...filters, before, limit: 200 }));
        rows = [...rows, ...older];
        tbody.insertAdjacentHTML('beforeend', older.map((m) => String(row(m))).join(''));
        $('#count', view).textContent = num(rows.length) + ' messages';
        if (older.length === 0) {
            toast('No older messages', 'info');
        }
    });

    tbody.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (button === null) {
            return;
        }

        const tr = button.closest('tr');
        const message = rows.find((r) => r.id === Number(tr.dataset.id));
        if (message === undefined) {
            return;
        }

        try {
            if (button.dataset.action === 'mute') {
                await dialog({
                    title: 'Mute ' + message.accountName,
                    text: 'The account can not write in the chat until the time is over.',
                    body: html`
                        <blockquote class="info-box" style="margin:0">${message.characterName}: ${message.text}</blockquote>
                        <label>Duration
                            <select name="minutes">
                                <option value="15">15 minutes</option><option value="60" selected>1 hour</option><option value="1440">1 day</option>
                                <option value="10080">7 days</option><option value="43200">30 days</option>
                            </select>
                        </label>
                        <label>Reason<textarea name="reason" maxlength="500">Chat message #${message.id}: ${message.text.slice(0, 200)}</textarea></label>`,
                    submit: 'Mute',
                    danger: true,
                    onSubmit: async (data) => {
                        await post('/api/players/' + message.account + '/status', { action: 'mute', minutes: Number(data.minutes), reason: data.reason });
                        await post('/api/chat/' + message.id + '/review', { action: 'offensive' });
                        toast(message.accountName + ' muted');
                        await load();
                    },
                });

                return;
            }

            const result = await post('/api/chat/' + message.id + '/review', { action: button.dataset.action });
            message.review = result.review;
            tr.outerHTML = String(row(message));
        } catch (error) {
            errorToast(error);
        }
    });

    await load();

    return live.on('chat', (list) => {
        if (paused) {
            buffered.push(...list);
            $('#paused', view).textContent = buffered.length + ' new message(s) while paused';

            return;
        }

        add(list);
    });
}
