import { html, $, get, qs, num, ago, accountLink, characterLink, errorToast } from '../core.js';
import { TYPE_NAME } from './encounters.js';

export async function render (view, params, query)
{
    const q = query.get('q') ?? '';

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head"><div><h1>Players</h1><div class="sub">Search accounts and characters or open a player that is online right now.</div></div></div>
            <form class="filters" id="search-form">
                <input type="search" name="q" placeholder="Account, character, e-mail or id…" value="${q}" style="width:340px" autofocus>
                <button class="primary" type="submit">Search</button>
            </form>
            <div id="results"></div>
            <div class="panel flush" style="margin-top:14px">
                <h2>Online now <span class="muted small" id="online-count"></span></h2>
                <div class="table-wrap scroll"><div id="online"></div></div>
            </div>
        </div>`);

    const search = async (text) => {
        if (text === '') {
            $('#results', view).innerHTML = '';

            return;
        }

        const data = await get('/api/search' + qs({ q: text }));
        $('#results', view).innerHTML = String(html`
            <div class="grid cols-2">
                <div class="panel flush">
                    <h2>Accounts</h2>
                    <table><thead><tr><th>#</th><th>Account</th><th>E-mail</th><th>Status</th></tr></thead><tbody>
                        ${data.accounts.map((a) => html`<tr><td class="muted">${a.id}</td><td>${accountLink(a.id, a.name)}</td><td>${a.email ?? ''}</td><td>${a.status === 2 ? html`<span class="badge sev-3">banned</span>` : html`<span class="badge ok">active</span>`}</td></tr>`)}
                        ${data.accounts.length === 0 ? html`<tr class="empty-row"><td colspan="4">No accounts</td></tr>` : ''}
                    </tbody></table>
                </div>
                <div class="panel flush">
                    <h2>Characters</h2>
                    <table><thead><tr><th>Character</th><th>Level</th><th>Class</th><th>Account</th></tr></thead><tbody>
                        ${data.characters.map((c) => html`<tr><td>${characterLink(c.id, c.name)}</td><td>${c.level}</td><td>${c.className ?? ''}</td><td>${accountLink(c.account, c.accountName)}</td></tr>`)}
                        ${data.characters.length === 0 ? html`<tr class="empty-row"><td colspan="4">No characters</td></tr>` : ''}
                    </tbody></table>
                </div>
            </div>`);
    };

    $('#search-form', view).addEventListener('submit', (event) => {
        event.preventDefault();
        const text = event.currentTarget.q.value.trim();
        history.replaceState(null, '', '/players' + qs({ q: text }));
        search(text).catch(errorToast);
    });

    const online = await get('/api/online');
    $('#online-count', view).textContent = '(' + online.length + ')';
    $('#online', view).innerHTML = String(html`
        <table>
            <thead><tr><th>Character</th><th>Level</th><th>Class</th><th>Account</th><th>Location</th><th>Server</th><th>Online since</th><th class="num">Open flags</th></tr></thead>
            <tbody>
                ${online.map((c) => html`<tr>
                    <td><span class="dot on"></span>${characterLink(c.character, c.name)}</td>
                    <td>${c.level}</td><td>${c.className ?? ''}</td>
                    <td>${accountLink(c.account, c.accountName)}</td>
                    <td>${c.instance ? html`<a href="/encounters/${c.instance.id}"><span class="badge type-${c.instance.type}">${TYPE_NAME[c.instance.type] ?? c.instance.type}</span> ${c.instance.name ?? ''}</a>` : (c.zoneName ?? html`<span class="muted">-</span>`)}</td>
                    <td class="muted">${c.serverName ?? ''}</td>
                    <td class="muted">${ago(c.start)}</td>
                    <td class="num">${c.flags > 0 ? html`<a href="/flags?account=${c.account}" class="bad">${num(c.flags)}</a>` : html`<span class="muted">-</span>`}</td>
                </tr>`)}
                ${online.length === 0 ? html`<tr class="empty-row"><td colspan="8">Nobody is online</td></tr>` : ''}
            </tbody>
        </table>`);

    await search(q);
}
