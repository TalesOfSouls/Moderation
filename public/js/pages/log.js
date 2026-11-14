import { html, get, dateTime, accountLink, characterLink } from '../core.js';
import { actionText } from './player.js';

export async function render (view)
{
    const actions = await get('/api/actions?limit=500');

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head"><div><h1>Moderation log</h1><div class="sub">Everything the team did in this tool (latest 500 entries).</div></div></div>
            <div class="panel flush"><div class="table-wrap scroll tall"><table>
                <thead><tr><th>Time</th><th>Moderator</th><th>Action</th><th>Account</th><th>Character</th><th>Detail</th></tr></thead>
                <tbody>
                    ${actions.map((x) => html`<tr>
                        <td class="nowrap muted">${dateTime(x.time)}</td>
                        <td>${x.moderatorName ?? html`<span class="muted">System</span>`}</td>
                        <td><span class="badge">${x.type.replace('_', ' ')}</span></td>
                        <td>${x.account ? accountLink(x.account, x.accountName) : html`<span class="muted">-</span>`}</td>
                        <td>${characterLink(x.character, x.characterName)}</td>
                        <td class="small">${typeof x.detail === 'string' ? x.detail : actionText(x.detail)}</td>
                    </tr>`)}
                    ${actions.length === 0 ? html`<tr class="empty-row"><td colspan="6">Nothing yet</td></tr>` : ''}
                </tbody>
            </table></div></div>
        </div>`);
}
