import { html, $, get, post, qs, num, ago, live, dialog, toast, errorToast, accountLink, sortable, sortRows, sortHeader } from '../core.js';
import { reportTable, bindReportReview } from '../reportview.js';
import { navigate } from '../app.js';

export async function render (view, params, query)
{
    const meta = await get('/api/meta');
    const tab = query.get('tab') === 'reporters' ? 'reporters' : 'reports';
    const state = { status: query.get('status') ?? 'open', category: query.get('category') ?? '', days: query.get('days') ?? '90' };

    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    root.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div><h1>Player reports</h1><div class="sub">Reports that players sent from the game. The reporter statistics show who reports a lot without reason.</div></div>
            </div>
            <div class="tabs" style="margin-top:0">
                <button type="button" data-page-tab="reports" class="${tab === 'reports' ? 'active' : ''}">Reports</button>
                <button type="button" data-page-tab="reporters" class="${tab === 'reporters' ? 'active' : ''}">Reporters</button>
            </div>
            <div id="content"></div>
        </div>`);

    const content = $('#content', root);
    const url = () => '/reports' + qs({ tab: tab === 'reporters' ? 'reporters' : '', ...(tab === 'reports' ? { status: state.status, category: state.category } : { days: state.days }) });

    // ----------------------------------------------------------------------------------------------------------------- reports

    const loadReports = async () => {
        const rows = await get('/api/reports' + qs({ status: state.status, category: state.category, limit: 300 }));
        content.innerHTML = String(html`
            <div class="filters">
                <div class="toggle">
                    ${[['open', 'Open'], ['action', 'Action taken'], ['rejected', 'No violation'], ['duplicate', 'Duplicate'], ['all', 'All']].map(([k, l]) => html`<button type="button" data-status="${k}" class="${state.status === k ? 'active' : ''}">${l}</button>`)}
                </div>
                <select data-category>
                    <option value="">All categories</option>
                    ${Object.entries(meta.reportCategories).map(([k, l]) => html`<option value="${k}" ${state.category === k ? 'selected' : ''}>${l}</option>`)}
                </select>
                <span class="small muted">${num(rows.length)} report(s)</span>
            </div>
            <div class="panel flush">${reportTable(rows, { tall: true })}</div>`);
    };

    // ----------------------------------------------------------------------------------------------------------------- reporters

    const sort = { key: 'rejected', dir: 'desc' };
    let reporters = null;

    const drawReporters = () => {
        const rows = sortRows(reporters.rows, sort);
        const limits = reporters.limits;
        const suspicious = (r) => r.actions + r.rejected >= limits.minResolved && r.rejected / (r.actions + r.rejected) >= limits.falseRatio;

        $('#reporters', content).innerHTML = String(html`
            <table>
                <thead><tr>
                    ${sortHeader('Reporter', 'name', sort)}
                    ${sortHeader('Reports', 'total', sort, 'num')}
                    ${sortHeader('Last 24h', 'lastDay', sort, 'num')}
                    ${sortHeader('Players reported', 'players', sort, 'num')}
                    ${sortHeader('Max. same player', 'maxSameTarget', sort, 'num')}
                    ${sortHeader('Action taken', 'actions', sort, 'num')}
                    ${sortHeader('No violation', 'rejected', sort, 'num')}
                    ${sortHeader('Open', 'open', sort, 'num')}
                    ${sortHeader('Right', 'accuracy', sort)}
                    ${sortHeader('Last report', 'last', sort)}
                    <th></th>
                </tr></thead>
                <tbody>
                    ${rows.map((r) => html`<tr class="${suspicious(r) ? 'flagged' : ''}">
                        <td class="nowrap">${accountLink(r.account, r.name)} ${r.status === 2 ? html`<span class="badge sev-3">banned</span>` : ''} ${r.blocked ? html`<span class="badge sev-2">reporting blocked</span>` : ''}</td>
                        <td class="num"><a href="/reports?status=all&reporter=${r.account}" data-reporter="${r.account}">${r.total}</a></td>
                        <td class="num">${r.lastDay}</td>
                        <td class="num">${r.players}</td>
                        <td class="num ${r.maxSameTarget >= 5 ? 'warm' : ''}">${r.maxSameTarget}</td>
                        <td class="num">${r.actions}</td>
                        <td class="num ${suspicious(r) ? 'hot' : ''}">${r.rejected}</td>
                        <td class="num">${r.open}</td>
                        <td style="min-width:110px">${r.accuracy === null ? html`<span class="muted">-</span>` : html`
                            <div class="row" style="gap:6px"><div class="bar ${r.accuracy < 0.25 ? 'hot' : ''}" style="flex:1"><i style="width:${Math.round(r.accuracy * 100)}%"></i></div><span class="small">${Math.round(r.accuracy * 100)}%</span></div>`}</td>
                        <td class="small muted nowrap">${ago(r.last)}</td>
                        <td class="nowrap">${r.blocked
                            ? html`<button class="small" data-unblock="${r.account}">Allow reports</button>`
                            : html`<button class="small danger" data-block="${r.account}" data-name="${r.name}">Block reporting</button>`}</td>
                    </tr>`)}
                    ${rows.length === 0 ? html`<tr class="empty-row"><td colspan="11">No reports in this period</td></tr>` : ''}
                </tbody>
            </table>`);
    };

    const loadReporters = async () => {
        reporters = await get('/api/reporters' + qs({ days: state.days }));
        content.innerHTML = String(html`
            <div class="filters">
                <div class="toggle">
                    ${[['30', '30 days'], ['90', '90 days'], ['365', '1 year']].map(([d, l]) => html`<button type="button" data-days="${d}" class="${state.days === d ? 'active' : ''}">${l}</button>`)}
                </div>
                <span class="small muted">Red rows: at least ${reporters.limits.minResolved} handled reports and ${Math.round(reporters.limits.falseRatio * 100)}% or more without violation (see configuration).</span>
            </div>
            <div class="panel flush"><div class="table-wrap scroll tall" id="reporters"></div></div>`);
        sortable($('#reporters', content), sort, drawReporters);
        drawReporters();
    };

    // ----------------------------------------------------------------------------------------------------------------- events

    root.addEventListener('click', async (event) => {
        const pageTab = event.target.closest('[data-page-tab]');
        if (pageTab) {
            navigate('/reports' + (pageTab.dataset.pageTab === 'reporters' ? '?tab=reporters' : ''), true);

            return;
        }

        const statusButton = event.target.closest('[data-status]');
        if (statusButton) {
            state.status = statusButton.dataset.status;
            navigate(url(), true);

            return;
        }

        const daysButton = event.target.closest('[data-days]');
        if (daysButton) {
            state.days = daysButton.dataset.days;
            navigate(url(), true);

            return;
        }

        const reporterLink = event.target.closest('[data-reporter]');
        if (reporterLink) {
            event.preventDefault();
            navigate('/players/' + reporterLink.dataset.reporter + '#reports');

            return;
        }

        const block = event.target.closest('[data-block]');
        const unblock = event.target.closest('[data-unblock]');
        try {
            if (block) {
                await dialog({
                    title: 'Block reporting for ' + block.dataset.name,
                    text: 'The player can not send reports during this time. Use Ban on the profile for serious cases.',
                    body: html`
                        <label>Duration <select name="minutes"><option value="1440">1 day</option><option value="10080" selected>7 days</option><option value="43200">30 days</option><option value="525600">1 year</option></select></label>
                        <label>Reason <textarea name="reason" maxlength="500" required>Many false reports</textarea></label>`,
                    submit: 'Block reporting',
                    danger: true,
                    onSubmit: async (v) => {
                        await post('/api/players/' + block.dataset.block + '/status', { action: 'block_reports', minutes: Number(v.minutes), reason: v.reason });
                        toast('Reporting blocked');
                        await loadReporters();
                    },
                });
            } else if (unblock) {
                await post('/api/players/' + unblock.dataset.unblock + '/status', { action: 'unblock_reports' });
                toast('Reporting allowed again');
                await loadReporters();
            }
        } catch (error) {
            errorToast(error);
        }
    });

    root.addEventListener('change', (event) => {
        if (event.target.matches('[data-category]')) {
            state.category = event.target.value;
            navigate(url(), true);
        }
    });

    bindReportReview(root, () => loadReports());

    if (tab === 'reports') {
        await loadReports();
    } else {
        await loadReporters();
    }

    let open = null;

    return live.on('status', (status) => {
        if (open !== null && status.openReports !== open && tab === 'reports') {
            loadReports().catch(() => {});
        }

        open = status.openReports;
    });
}
