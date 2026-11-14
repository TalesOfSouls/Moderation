/**
 * Conversation around a chat message (messages before and after it)
 *
 * Every element with data-chat-context="<message id>" opens it (see app.js).
 */
import { html, get, qs, clock, dateTime, accountLink, characterLink, errorToast } from './core.js';
import { highlight } from './flagview.js';

const SCOPES = {
    whisper: 'Whisper conversation',
    encounter: 'Instance / match',
    guild: 'Guild chat',
    channel: 'Same channel',
    zone: 'All channels in the zone',
    player: 'Everything of this player',
};

export async function openConversation (id)
{
    const state = { scope: 'auto', before: 25, after: 25 };
    const el = document.createElement('dialog');
    el.className = 'wide';
    document.body.appendChild(el);

    const close = () => {
        el.close();
        el.remove();
    };

    el.addEventListener('close', () => el.remove());
    el.addEventListener('click', async (event) => {
        if (event.target === el || event.target.closest('[data-close]')) {
            close();

            return;
        }

        const scope = event.target.closest('[data-scope]');
        if (scope) {
            state.scope = scope.dataset.scope;
            state.before = 25;
            state.after = 25;
            await load();

            return;
        }

        if (event.target.closest('[data-more="before"]')) {
            state.before += 50;
            await load();
        } else if (event.target.closest('[data-more="after"]')) {
            state.after += 50;
            await load();
        } else if (event.target.closest('a')) {
            close();
        }
    });

    const load = async () => {
        let data;
        try {
            data = await get('/api/chat/' + id + '/context' + qs(state));
        } catch (error) {
            errorToast(error);
            close();

            return;
        }

        state.scope = data.scope;
        const focus = data.messages.find((m) => m.id === data.focus);

        el.innerHTML = String(html`
            <div class="panel-head">
                <h2 style="margin:0">Conversation ${focus ? html`<span class="muted small">around the message of ${focus.characterName} · ${dateTime(focus.time)}</span>` : ''}</h2>
                <button class="small ghost" data-close>Close</button>
            </div>
            <div class="toggle" style="margin-bottom:10px">
                ${data.scopes.map((s) => html`<button type="button" data-scope="${s}" class="${s === data.scope ? 'active' : ''}">${SCOPES[s] ?? s}</button>`)}
            </div>
            <div class="conversation-list" id="conversation-list">
                ${data.moreBefore ? html`<div class="center"><button class="small" data-more="before">Earlier messages</button></div>` : html`<div class="center small muted">Start of the conversation</div>`}
                <table class="feed">
                    <tbody>
                        ${data.messages.map((m) => html`<tr class="${m.id === data.focus ? 'focus' : ''} ${m.badWords.length > 0 ? 'flagged' : ''}" ${m.id === data.focus ? html`id="conversation-focus"` : ''}>
                            <td class="time" title="${dateTime(m.time)}">${clock(m.time)}</td>
                            <td><span class="channel c-${m.channel}">${m.channelName}</span></td>
                            <td class="nowrap">${characterLink(m.character, m.characterName)} <span class="small muted">${accountLink(m.account, m.accountName)}</span></td>
                            <td class="msg">${m.toCharacter ? html`<span class="muted">→ ${characterLink(m.toCharacter, m.toName)}:</span> ` : ''}${highlight(m.text, m.badWords)}</td>
                            <td class="small muted nowrap">${m.instanceName ?? m.zoneName ?? ''}</td>
                        </tr>`)}
                    </tbody>
                </table>
                ${data.moreAfter ? html`<div class="center"><button class="small" data-more="after">Later messages</button></div>` : html`<div class="center small muted">No later messages</div>`}
            </div>`);

        if (!el.open) {
            el.showModal();
        }

        el.querySelector('#conversation-focus')?.scrollIntoView({ block: 'center' });
    };

    await load();
}
