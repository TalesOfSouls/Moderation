import { html, $, get, dateTime, accountLink, characterLink, errorToast } from '../core.js';
import { renderInventory } from '../inventoryview.js';

export async function render (view, params)
{
    const id = Number(params[0]);
    const data = await get('/api/guilds/' + id);
    const g = data.guild;

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div class="profile-head">
                    <div class="avatar">${(g.tag ?? g.name).slice(0, 2).toUpperCase()}</div>
                    <div><h1>${g.name} ${g.tag ? html`<span class="muted small">[${g.tag}]</span>` : ''}</h1>
                        <div class="muted">${g.serverName ?? ''} · created ${dateTime(g.created)} · ${data.members.length} members ${g.recruiting ? html`· <span class="badge ok">recruiting</span>` : ''}</div></div>
                </div>
            </div>
            ${g.description ? html`<p class="muted">${g.description}</p>` : ''}
            <div class="grid side">
                <div id="vault"></div>
                <div class="panel flush">
                    <h2>Members</h2>
                    <div class="table-wrap scroll"><table>
                        <thead><tr><th>Character</th><th>Level</th><th>Role</th><th>Account</th><th class="num">Flags</th></tr></thead>
                        <tbody>
                            ${data.members.map((m) => html`<tr>
                                <td>${characterLink(m.id, m.name)}</td><td>${m.level}</td>
                                <td class="small">${m.role ?? ''}${m.rank ? html`<div class="muted">${m.rank}</div>` : ''}</td>
                                <td>${accountLink(m.account, m.accountName)} ${m.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''}</td>
                                <td class="num">${m.flags > 0 ? html`<a class="bad" href="/flags?account=${m.account}">${m.flags}</a>` : html`<span class="muted">-</span>`}</td>
                            </tr>`)}
                            ${data.members.length === 0 ? html`<tr class="empty-row"><td colspan="5">No members</td></tr>` : ''}
                        </tbody>
                    </table></div>
                </div>
            </div>
        </div>`);

    await renderInventory($('#vault', view), { type: 'guild', id, title: 'Guild vault' }).catch(errorToast);
}
