import { html, $, get, post, live, ago, dateTime, accountLink, errorToast } from '../core.js';

export async function render (view, params)
{
    const current = params[0] ? Number(params[0]) : null;
    let threads = [];
    let thread = null;

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div><h1>Player support</h1><div class="sub">Messages between the team and players. The game shows the messages to the player in a support window and sends the answers back.</div></div>
            </div>
            <div class="support">
                <div class="panel threads" id="threads"></div>
                <div class="panel conversation" id="conversation">
                    ${current === null ? html`<div class="messages"><p class="muted">Select a conversation or open a player profile and click “Message”.</p></div>` : ''}
                </div>
            </div>
        </div>`);

    const drawThreads = () => {
        $('#threads', view).innerHTML = String(html`
            ${threads.map((t) => html`<a href="/support/${t.account}" class="${t.account === current ? 'active' : ''} ${t.unread > 0 ? 'unread' : ''}">
                <div class="row" style="justify-content:space-between"><span>${t.name ?? '#' + t.account}</span><span class="small muted">${ago(t.last)}</span></div>
                <div class="preview">${t.lastDirection === 0 ? 'You: ' : ''}${t.preview}</div>
                ${t.unread > 0 ? html`<span class="count alert">${t.unread}</span>` : ''}
            </a>`)}
            ${threads.length === 0 ? html`<p class="muted" style="padding:12px">No conversations yet</p>` : ''}`);
    };

    const bubble = (m) => html`
        <div class="bubble ${m.direction === 0 ? 'mod' : ''}" data-id="${m.id}">
            <div>${m.text}</div>
            <div class="meta">${m.direction === 0 ? (m.moderatorName ?? 'Team') : (m.characterName ?? thread?.account?.name ?? 'Player')} · ${dateTime(m.time)}
                ${m.direction === 0 ? (m.delivered ? ' · delivered' : ' · waiting for the game…') : ''}</div>
        </div>`;

    const drawThread = () => {
        const a = thread.account;
        const online = thread.characters.filter((c) => c.online);
        const box = $('#conversation', view);

        box.innerHTML = String(html`
            <div class="head">
                <div><b>${accountLink(a.id, a.name)}</b> ${online.length > 0 ? html`<span class="badge online">online as ${online.map((c) => c.name).join(', ')}</span>` : html`<span class="badge">offline</span>`}
                    ${a.muted ? html`<span class="badge sev-2">muted</span>` : ''} ${a.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}</div>
                <a class="button small" href="/players/${a.id}">Profile</a>
            </div>
            <div class="messages" id="messages">
                ${thread.messages.map(bubble)}
                ${thread.messages.length === 0 ? html`<p class="muted">No messages yet. Write the first message below.</p>` : ''}
            </div>
            <form class="composer" id="composer">
                <select name="character" title="Character that receives the message in the game">
                    <option value="">All characters</option>
                    ${thread.characters.map((c) => html`<option value="${c.id}" ${online[0]?.id === c.id ? 'selected' : ''}>${c.name}${c.online ? ' (online)' : ''}</option>`)}
                </select>
                <textarea name="text" maxlength="1000" placeholder="Message to ${a.name}… (Enter to send, Shift+Enter for a new line)" required></textarea>
                <button class="primary" type="submit">Send</button>
            </form>`);

        const messages = $('#messages', view);
        messages.scrollTop = messages.scrollHeight;

        const form = $('#composer', view);
        const send = async () => {
            const text = form.text.value.trim();
            if (text === '') {
                return;
            }

            form.querySelector('button').disabled = true;
            try {
                await post('/api/support/' + a.id, { text, character: form.character.value || null });
                form.text.value = '';
                await loadThread();
            } catch (error) {
                errorToast(error);
            } finally {
                form.querySelector('button').disabled = false;
                form.text.focus();
            }
        };

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            send();
        });

        form.text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
            }
        });

        form.text.focus();
    };

    const loadThreads = async () => {
        threads = await get('/api/support');
        drawThreads();
    };

    const loadThread = async () => {
        if (current === null) {
            return;
        }

        thread = await get('/api/support/' + current);
        drawThread();
        await loadThreads();
    };

    await loadThreads();
    await loadThread();

    return live.on('support', (rows) => {
        if (current !== null && rows.some((r) => r.account === current)) {
            // keep what the moderator is typing
            const text = $('#composer textarea', view)?.value ?? '';
            loadThread().then(() => {
                const area = $('#composer textarea', view);
                if (area) {
                    area.value = text;
                }
            }).catch(() => {});
        } else {
            loadThreads().catch(() => {});
        }
    });
}
