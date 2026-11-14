/**
 * Rendering of flags (shared by the suspicious activity page and the profiles)
 */
import { html, num, dateTime, duration, ago, severityBadge, accountLink, characterLink, esc, raw, post, toast, errorToast, dialog } from './core.js';

export function formatValue (flag)
{
    const v = flag.value;
    const t = flag.threshold;

    switch (flag.rule) {
        case 'xp_rate': return [num(v) + ' xp/h', num(t)];
        case 'gold_rate': return [num(v, 1) + ' gold/min', num(t)];
        case 'drop_rate': return [num(v, 1) + ' items/min', num(t, 1)];
        case 'playtime': return [num(v, 1) + ' h/day', num(t, 1)];
        case 'chat_toxic': return [num(v) + ' messages', num(t)];
        case 'chat_spam': return [num(v) + '× repeated', num(t)];
        case 'bot_path': return [Math.round(v * 100) + '% same route', Math.round(t * 100) + '%'];
        case 'input_script': return flag.detail?.reason === 'fast' ? [Math.round(v * 100) + '% inhuman inputs', Math.round(t * 100) + '%'] : ['timing CV ' + num(v, 3), num(t, 2)];
        case 'apm': return [num(v) + ' apm', num(t)];
        case 'streak': return [num(v) + ' ' + (flag.detail?.type ?? '') + ' in a row', num(t)];
        case 'short_matches': return [num(v) + ' short matches', num(t)];
        case 'auction_price': return [num(v, v < 1 ? 2 : 1) + '× median', num(t, 2) + '×'];
        case 'trade_gold': return [num(v) + ' gold', num(t)];
        case 'shared_hardware': return [num(v) + ' accounts', num(t)];
        case 'item_dupe': return [num(v) + ' copies', '1'];
        case 'item_origin': return [num(v) + ' item(s)', '0'];
        case 'item_quantity': return [num(v) + ' in stack', num(t) + ' added'];
        case 'false_reports': return [Math.round(v * 100) + '% unfounded', Math.round(t * 100) + '%'];
        case 'report_spam': return [num(v) + ' reports', num(t)];
        default: return [num(v, 2), num(t, 2)];
    }
}

function highlight (text, words)
{
    let out = esc(text);
    for (const word of words ?? []) {
        const pattern = new RegExp('(' + esc(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        out = out.replace(pattern, '<mark>$1</mark>');
    }

    return raw(out);
}

export { highlight };

export function formatDetail (flag)
{
    const d = flag.detail ?? {};
    const cname = (id) => flag.names?.['c' + id] ?? null;
    const aname = (id) => flag.names?.['a' + id] ?? '#' + id;

    switch (flag.rule) {
        case 'xp_rate':
            return html`${num(d.xp)} xp in ${d.hours} h of playtime (last ${d.windowHours} h)`;
        case 'gold_rate':
            return html`${num(d.gold)} gold from loot/quests/vendors in ${d.hours} h of playtime (last ${d.windowHours} h)`;
        case 'drop_rate':
            return html`${d.drops} drops between ${dateTime(d.from)} and ${dateTime(d.to).slice(11)} · <a href="/drops?account=${flag.account}">show drops</a>`;
        case 'playtime':
            return html`${d.hours} h played in the last 5 days (${d.days} days with sessions)`;
        case 'chat_toxic':
            return html`<ul>${(d.messages ?? []).slice(-4).map((m) => html`<li data-chat-context="${m.id}" title="Show the conversation"><span class="muted">${dateTime(m.time)}</span> ${highlight(m.text, m.words)}</li>`)}</ul>
                <a href="/chat?account=${flag.account}">show chat</a>`;
        case 'chat_spam':
            return html`"${d.text}" · ${d.total} times in total · <a href="/chat?account=${flag.account}">show chat</a>`;
        case 'bot_path':
            return html`${(d.sessions ?? []).length} of ${d.checked} sessions follow the same route (average similarity ${Math.round((d.average ?? 0) * 100)}%) ·
                <a href="/characters/${flag.character}#path">compare routes</a>`;
        case 'input_script': {
            const c = d.combo;

            return html`${d.reason === 'fast' ? '' : 'Very regular timing'}${c ? html` · combo ${c.combo}: ${num(c.mean)} ms ± ${num(c.mean * c.cv, 1)} ms (${c.samples}×)` : ''}
                · ${Math.round((d.fastRatio ?? 0) * 100)}% of ${num(d.inputs)} inputs faster than the human limit · <a href="/characters/${flag.character}#inputs">input analysis</a>`;
        }
        case 'apm':
            return html`${d.count} encounter(s) above the limit: ${(d.encounters ?? []).slice(-6).map((id, i) => html`${i > 0 ? ', ' : ''}<a href="/encounters/${id}">#${id}</a>`)}`;
        case 'streak':
            return html`${flag.value} ${d.type} in a row (matches <a href="/encounters/${d.from}">#${d.from}</a> - <a href="/encounters/${d.to}">#${d.to}</a>) · <a href="/encounters?type=pvp&account=${flag.account}">all matches</a>`;
        case 'short_matches':
            return html`Durations: ${(d.matches ?? []).slice(-10).map((m, i) => html`${i > 0 ? ', ' : ''}<a href="/encounters/${m.id}">${duration(m.duration)} ${m.won ? 'W' : 'L'}</a>`)} · <a href="/encounters?short=1&account=${flag.account}">all short matches</a>`;
        case 'auction_price':
            return html`<ul>${(d.auctions ?? []).slice(-4).map((a) => html`<li>Auction #${a.id} (${a.role}): ${num(a.unit)} gold/unit, median ${num(a.median)} (${num(a.factor, 2)}×)
                ${a.buyer ? html` · bought by ${characterLink(a.buyer, cname(a.buyer))}${a.soldAfter !== null ? ' after ' + duration(a.soldAfter) : ''}` : ''} · seller ${characterLink(a.seller, cname(a.seller))}</li>`)}</ul>`;
        case 'trade_gold':
            return html`<ul>${(d.trades ?? []).slice(-4).map((tr) => html`<li>Trade #${tr.id}: ${tr.role} ${num(tr.gold)} gold ${tr.role === 'gave' ? 'to' : 'from'} ${characterLink(tr.partner, cname(tr.partner))} for nothing <span class="muted">${ago(tr.time)}</span></li>`)}</ul>
                <a href="/trades?account=${flag.account}">show trades</a>`;
        case 'item_dupe':
            return html`<b>${d.name}</b> <a class="mono" href="/items?uid=${d.uid}">${String(d.uid).slice(0, 8)}…</a> exists ${(d.copies ?? []).length}×:
                <ul>${(d.copies ?? []).map((c) => html`<li>${c.ownerType === 'character' ? characterLink(c.owner, cname(c.owner)) : (c.ownerType === 'account' ? accountLink(c.owner, aname(c.owner)) : html`<a href="/guilds/${c.owner}">guild #${c.owner}</a>`)}
                    (${c.container}) since ${dateTime(c.created)}</li>`)}</ul>
                <a href="/items?uid=${d.uid}">trace item</a>`;
        case 'item_origin':
            return html`No record how these items were obtained:
                <ul>${(d.items ?? []).slice(0, 4).map((i) => html`<li>${i.quantity > 1 ? i.quantity + '× ' : ''}${i.name} · <a class="mono" href="/items?uid=${i.uid}">${String(i.uid).slice(0, 8)}…</a> · ${ago(i.created)}</li>`)}</ul>
                ${d.count > 4 ? html`and ${d.count - 4} more · ` : ''}<a href="/players/${flag.account}#inventory">inventory</a>`;
        case 'item_quantity':
            return html`Stack of <b>${d.name}</b> has ${num(d.quantity)} items, but only ${num(d.added)} were ever added · <a class="mono" href="/items?uid=${d.uid}">trace item</a>`;
        case 'false_reports':
            return html`${d.total} reports filed: ${d.actions} resulted in an action, ${d.rejected} without violation · <a href="/players/${flag.account}#reports">reports</a>`;
        case 'report_spam':
            return html`${d.day} report(s) in the last 24 hours${d.target ? html` · ${d.target.count} reports against ${accountLink(d.target.target, d.target.targetName)} within 7 days` : ''} ·
                <a href="/players/${flag.account}#reports">reports</a>`;
        case 'shared_hardware':
            return html`Hardware <span class="mono">${d.hardware}</span>: ${(d.accounts ?? []).map((a, i) => html`${i > 0 ? ', ' : ''}${accountLink(a, aname(a))}`)}`;
        default:
            return html`<span class="mono">${JSON.stringify(d)}</span>`;
    }
}

/**
 * Table of flags with review buttons
 *
 * @param {object[]} flags
 * @param {{account?:boolean}} options
 */
export function flagTable (flags, options = {})
{
    return html`
        <div class="table-wrap">
            <table class="flags">
                <thead><tr>
                    <th>Severity</th><th>Rule</th>${options.account !== false ? html`<th>Account</th>` : ''}<th>Character</th><th>Value</th><th>Limit</th>
                    <th>Detail</th><th>Seen</th><th>Status</th><th></th>
                </tr></thead>
                <tbody>
                    ${flags.map((f) => {
                        const [value, limit] = formatValue(f);

                        return html`<tr data-flag="${f.id}">
                            <td>${severityBadge(f.severity)}</td>
                            <td class="nowrap"><b>${f.label}</b></td>
                            ${options.account !== false ? html`<td class="nowrap">${accountLink(f.account, f.accountName)}${f.accountStatus === 2 ? html` <span class="badge sev-3">banned</span>` : ''}</td>` : ''}
                            <td class="nowrap">${characterLink(f.character, f.characterName)}</td>
                            <td class="nowrap bad">${value}</td>
                            <td class="nowrap muted">${limit}</td>
                            <td class="flag-detail">${formatDetail(f)}</td>
                            <td class="nowrap small muted" title="first seen ${dateTime(f.firstSeen)}">${ago(f.lastSeen)}<br>${f.hits}× checked</td>
                            <td class="nowrap"><span class="badge ${f.status}">${f.status}</span>${f.reviewerName ? html`<div class="small muted">${f.reviewerName}</div>` : ''}${f.note ? html`<div class="small muted" title="${f.note}">“${f.note.slice(0, 40)}”</div>` : ''}</td>
                            <td class="nowrap">
                                ${f.status !== 'confirmed' ? html`<button class="small danger" data-review="confirmed">Confirm</button>` : ''}
                                ${f.status !== 'dismissed' ? html`<button class="small" data-review="dismissed">Dismiss</button>` : ''}
                                ${f.status !== 'open' ? html`<button class="small ghost" data-review="open">Reopen</button>` : ''}
                            </td>
                        </tr>`;
                    })}
                    ${flags.length === 0 ? html`<tr class="empty-row"><td colspan="10">No flags</td></tr>` : ''}
                </tbody>
            </table>
        </div>`;
}

/**
 * Review buttons (confirm/dismiss asks for an optional note)
 */
export function bindFlagReview (root, reload)
{
    root.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-review]');
        if (button === null) {
            return;
        }

        const row = button.closest('[data-flag]');
        const status = button.dataset.review;
        const send = async (note) => {
            await post('/api/flags/' + row.dataset.flag, { status, note });
            toast('Flag ' + status);
            await reload();
        };

        if (status === 'open') {
            send('').catch(errorToast);

            return;
        }

        await dialog({
            title: status === 'confirmed' ? 'Confirm flag' : 'Dismiss flag',
            text: status === 'confirmed' ? 'The behavior is a real violation. Take further actions (mute, ban, message) on the player profile.' : 'The flag is a false alarm, it will not be shown again for this period.',
            body: html`<label>Note (optional)<textarea name="note" maxlength="1000"></textarea></label>`,
            submit: status === 'confirmed' ? 'Confirm' : 'Dismiss',
            danger: status === 'confirmed',
            onSubmit: (data) => send(data.note),
        });
    });
}
