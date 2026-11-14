/**
 * Player reports (shared by the reports page and the player profile)
 */
import { html, post, dateTime, ago, accountLink, characterLink, dialog, toast, errorToast } from './core.js';

const STATUS_CLASS = { open: 'open', action: 'confirmed', rejected: 'dismissed', duplicate: 'cancelled' };

function accuracy (actions, rejected)
{
    return actions + rejected > 0 ? Math.round(actions / (actions + rejected) * 100) + '%' : '-';
}

/**
 * @param {object[]} rows
 * @param {{reporter?:boolean, target?:boolean}} options
 */
export function reportTable (rows, options = {})
{
    return html`
        <div class="table-wrap scroll ${options.tall ? 'tall' : ''}"><table class="reports">
            <thead><tr>
                <th>#</th><th>Date</th><th>Category</th>
                ${options.reporter !== false ? html`<th>Reporter</th>` : ''}
                ${options.target !== false ? html`<th>Reported player</th>` : ''}
                <th>Report</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
                ${rows.map((r) => {
                    const poorReporter = r.reporterActions + r.reporterRejected >= 5 && r.reporterActions / (r.reporterActions + r.reporterRejected) < 0.25;

                    return html`<tr data-report="${r.id}">
                        <td class="muted">${r.id}</td>
                        <td class="nowrap small" title="${dateTime(r.created)}">${dateTime(r.created)}<br><span class="muted">${ago(r.created)}</span></td>
                        <td><span class="badge">${r.categoryName}</span></td>
                        ${options.reporter !== false ? html`<td class="nowrap">${accountLink(r.reporter, r.reporterName)}
                            ${(r.reporterBlockedUntil ?? 0) > Date.now() / 1000 ? html` <span class="badge sev-2">blocked</span>` : ''}
                            <div class="small ${poorReporter ? 'bad' : 'muted'}" title="Reports of this player that resulted in an action">${r.reporterTotal} reports · ${r.reporterActions} actions · ${accuracy(r.reporterActions, r.reporterRejected)} right</div></td>` : ''}
                        ${options.target !== false ? html`<td class="nowrap">${accountLink(r.account, r.accountName)}${r.accountStatus === 2 ? html` <span class="badge sev-3">banned</span>` : ''}
                            ${(r.accountMutedUntil ?? 0) > Date.now() / 1000 ? html` <span class="badge sev-2">muted</span>` : ''}
                            <div class="small muted">${characterLink(r.character, r.characterName)}</div>
                            <div class="small ${r.targetActions > 0 ? 'warn' : 'muted'}">${r.targetTotal} reports by ${r.targetReporters} player(s) · ${r.targetActions} actions${r.targetFlags > 0 ? html` · <a href="/flags?account=${r.account}" class="bad">${r.targetFlags} open flags</a>` : ''}</div></td>` : ''}
                        <td class="msg">${r.text}
                            ${r.chatText ? html`<div class="info-box small" style="margin-top:4px" data-chat-context="${r.chatMessage}" title="Show the conversation">Chat ${dateTime(r.chatTime)}: ${r.chatText}</div>` : ''}
                            <div class="small muted">${r.zoneName ?? ''} ${r.serverName ? '· ' + r.serverName : ''}</div></td>
                        <td class="nowrap"><span class="badge ${STATUS_CLASS[r.status] ?? ''}">${r.statusName}</span>
                            ${r.moderatorName ? html`<div class="small muted">${r.moderatorName}${r.handled ? ', ' + ago(r.handled) : ''}</div>` : ''}
                            ${r.note ? html`<div class="small muted" title="${r.note}">“${r.note.slice(0, 40)}”</div>` : ''}</td>
                        <td><div class="report-actions">
                            ${r.status !== 'action' ? html`<button class="small danger" data-report-status="action" title="The report was right, an action was taken">Action taken</button>` : ''}
                            ${r.status !== 'rejected' ? html`<button class="small" data-report-status="rejected" title="No violation found">No violation</button>` : ''}
                            ${r.status === 'open' ? html`<button class="small ghost" data-report-status="duplicate">Duplicate</button>` : html`<button class="small ghost" data-report-status="open">Reopen</button>`}
                        </div></td>
                    </tr>`;
                })}
                ${rows.length === 0 ? html`<tr class="empty-row"><td colspan="8">No reports</td></tr>` : ''}
            </tbody>
        </table></div>`;
}

export function bindReportReview (root, reload)
{
    root.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-report-status]');
        if (button === null) {
            return;
        }

        const id = button.closest('[data-report]').dataset.report;
        const status = button.dataset.reportStatus;
        const send = async (note) => {
            const result = await post('/api/reports/' + id, { status, note });
            toast(result.message);
            await reload();
        };

        try {
            if (status === 'open' || status === 'duplicate') {
                await send('');

                return;
            }

            await dialog({
                title: status === 'action' ? 'Report #' + id + ': action taken' : 'Report #' + id + ': no violation',
                text: status === 'action'
                    ? 'Take the action (mute, ban, message, remove items, …) on the profile of the reported player. Here only the result of the report is stored.'
                    : 'The reported player did nothing wrong. Unfounded reports lower the accuracy of the reporter.',
                body: html`<label>Note (optional) <textarea name="note" maxlength="1000"></textarea></label>`,
                submit: status === 'action' ? 'Action taken' : 'No violation',
                danger: status === 'action',
                onSubmit: (values) => send(values.note),
            });
        } catch (error) {
            errorToast(error);
        }
    });
}
