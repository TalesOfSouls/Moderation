import { html, $, get, post, qs, live, toast, errorToast, ago, num } from '../core.js';
import { flagTable, bindFlagReview } from '../flagview.js';
import { navigate } from '../app.js';

export async function render (view, params, query)
{
    const meta = await get('/api/meta');
    const state = {
        status: query.get('status') ?? 'open',
        rule: query.get('rule') ?? '',
        severity: query.get('severity') ?? '',
        account: query.get('account') ?? '',
    };

    view.innerHTML = String(html`
        <div class="page">
            <div class="page-head">
                <div>
                    <h1>Suspicious activity</h1>
                    <div class="sub">Found automatically by the rules of the <a href="/config">configuration</a>. Rules run every minute.</div>
                </div>
                <div class="actions">
                    <span class="small muted" id="last-run"></span>
                    <button id="run" class="primary">Run detection now</button>
                </div>
            </div>

            <form class="filters" id="filters">
                <div class="toggle" id="status">
                    ${['open', 'confirmed', 'dismissed', 'all'].map((s) => html`<button type="button" data-status="${s}" class="${state.status === s ? 'active' : ''}">${s}</button>`)}
                </div>
                <label>Rule
                    <select name="rule">
                        <option value="">All rules</option>
                        ${Object.entries(meta.rules).map(([id, r]) => html`<option value="${id}" ${state.rule === id ? 'selected' : ''}>${r.label}</option>`)}
                    </select>
                </label>
                <label>Severity
                    <select name="severity">
                        <option value="">All</option>
                        <option value="2" ${state.severity === '2' ? 'selected' : ''}>Medium and high</option>
                        <option value="3" ${state.severity === '3' ? 'selected' : ''}>High</option>
                    </select>
                </label>
                ${state.account ? html`<span class="badge">Account #${state.account} <a href="/flags">×</a></span>` : ''}
                <span class="muted small" id="count"></span>
            </form>

            <div class="panel flush" id="list"></div>
        </div>`);

    const list = $('#list', view);

    const load = async () => {
        const data = await get('/api/flags' + qs(state));
        list.innerHTML = String(flagTable(data.flags));
        $('#count', view).textContent = num(data.flags.length) + ' flag(s)';
        if (data.lastRun) {
            $('#last-run', view).textContent = 'Last check ' + ago(data.lastRun.time) + ' (' + data.lastRun.ms + ' ms)';
        }
    };

    const update = () => {
        navigate('/flags' + qs(state), true);
    };

    $('#status', view).addEventListener('click', (event) => {
        const button = event.target.closest('[data-status]');
        if (button) {
            state.status = button.dataset.status;
            update();
        }
    });

    $('#filters', view).addEventListener('change', (event) => {
        state[event.target.name] = event.target.value;
        update();
    });

    $('#run', view).addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try {
            const result = await post('/api/flags/run');
            toast('Detection finished: ' + result.message);
            await load();
        } catch (error) {
            errorToast(error);
        } finally {
            event.target.disabled = false;
        }
    });

    bindFlagReview(list, load);
    await load();

    const off = live.on('flags', () => load().catch(() => {}));

    return off;
}
