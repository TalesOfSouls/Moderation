/**
 * Small helpers: API calls, HTML templates, formatting, notifications, live updates, charts
 */

// ---------------------------------------------------------------------------------------------------------------------
// HTML templates (values are escaped, raw() marks trusted HTML)
// ---------------------------------------------------------------------------------------------------------------------

class Raw
{
    constructor (value) { this.value = String(value); }
    toString () { return this.value; }
}

export const raw = (value) => new Raw(value);

export function esc (value)
{
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function part (value)
{
    if (value instanceof Raw) {
        return value.value;
    }

    if (Array.isArray(value)) {
        return value.map(part).join('');
    }

    if (value === null || value === undefined || value === false) {
        return '';
    }

    return esc(value);
}

/**
 * html`<b>${name}</b>` -> Raw (escaped)
 */
export function html (strings, ...values)
{
    let out = strings[0];
    for (let i = 0; i < values.length; ++i) {
        out += part(values[i]) + strings[i + 1];
    }

    return new Raw(out);
}

export function $ (selector, root = document) { return root.querySelector(selector); }
export function $$ (selector, root = document) { return [...root.querySelectorAll(selector)]; }

// ---------------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------------

export const session = { account: null, csrf: '' };

export class ApiError extends Error
{
    constructor (status, message, fields)
    {
        super(message);
        this.status = status;
        this.fields = fields ?? null;
    }
}

export async function api (method, url, body = undefined)
{
    const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    if (method !== 'GET') {
        options.headers['X-CSRF-Token'] = session.csrf;
    }

    const response = await fetch(url, options);
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (response.status === 401 && !url.endsWith('/api/login')) {
        window.dispatchEvent(new CustomEvent('signed-out'));
    }

    if (!response.ok) {
        throw new ApiError(response.status, data?.error ?? 'Request failed (' + response.status + ')', data?.fields);
    }

    return data;
}

export const get  = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const del  = (url) => api('DELETE', url);

/**
 * Query string from an object (empty values are left out)
 */
export function qs (params)
{
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== undefined && value !== '') {
            search.set(key, value);
        }
    }

    const text = search.toString();

    return text === '' ? '' : '?' + text;
}

// ---------------------------------------------------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat('en-US');

export function num (value, digits = 0)
{
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '-';
    }

    return digits === 0 ? numberFormat.format(Math.round(value)) : Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compact (value)
{
    const v = Number(value) || 0;
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'k';

    return num(v);
}

export function duration (seconds)
{
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);

    if (h >= 24) {
        return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
    }

    if (h > 0) {
        return h + 'h ' + String(m).padStart(2, '0') + 'm';
    }

    return m > 0 ? m + 'm ' + String(s % 60).padStart(2, '0') + 's' : s + 's';
}

/**
 * unix seconds (or "YYYY-MM-DD HH:MM:SS" UTC) -> Date
 */
export function toDate (value)
{
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        return new Date(value * 1000);
    }

    const d = new Date(String(value).replace(' ', 'T') + (String(value).length <= 19 ? 'Z' : ''));

    return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

export function dateTime (value)
{
    const d = toDate(value);

    return d === null ? '-' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function clock (value)
{
    const d = toDate(value);

    return d === null ? '-' : pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function ago (value)
{
    const d = toDate(value);
    if (d === null) {
        return '-';
    }

    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 0) return 'in ' + duration(-s);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';

    return Math.floor(s / 86400) + 'd ago';
}

export const SEVERITY = { 1: 'low', 2: 'medium', 3: 'high' };

export function severityBadge (severity)
{
    return html`<span class="badge sev-${severity}">${SEVERITY[severity] ?? severity}</span>`;
}

export const RARITY_CLASS = { 1: 'r-white', 2: 'r-blue', 3: 'r-yellow', 4: 'r-orange', 5: 'r-green', 6: 'r-purple', 7: 'r-red' };

export function accountLink (id, name)
{
    return id ? html`<a href="/players/${id}" class="account-link">${name ?? '#' + id}</a>` : html`<span class="muted">-</span>`;
}

export function characterLink (id, name)
{
    return id ? html`<a href="/characters/${id}" class="character-link">${name ?? '#' + id}</a>` : html`<span class="muted">-</span>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------------------------------------------------

export function toast (message, type = 'ok')
{
    const box = $('#toasts');
    if (box === null) {
        return;
    }

    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.classList.add('hide'), 3500);
    setTimeout(() => el.remove(), 4000);
}

export function errorToast (error)
{
    toast(error instanceof Error ? error.message : String(error), 'error');
}

/**
 * Show field errors of an ApiError in a form
 */
export function formErrors (form, error)
{
    $$('.field-error', form).forEach((e) => e.remove());
    $$('.invalid', form).forEach((e) => e.classList.remove('invalid'));

    if (!(error instanceof ApiError) || error.fields === null) {
        errorToast(error);

        return;
    }

    for (const [name, message] of Object.entries(error.fields)) {
        const input = form.querySelector('[name="' + name + '"]');
        if (input === null) {
            continue;
        }

        input.classList.add('invalid');
        const hint = document.createElement('div');
        hint.className = 'field-error';
        hint.textContent = message;
        input.insertAdjacentElement('afterend', hint);
    }

    errorToast(error);
}

export function formData (form)
{
    const data = {};
    for (const el of form.elements) {
        if (!el.name || el.disabled) {
            continue;
        }

        if (el.type === 'checkbox') {
            data[el.name] = el.checked;
        } else {
            data[el.name] = el.value;
        }
    }

    return data;
}

// ---------------------------------------------------------------------------------------------------------------------
// live updates (one EventSource, pages subscribe to channels)
// ---------------------------------------------------------------------------------------------------------------------

const listeners = new Map();
let source = null;
let channelsKey = '';

export const live = {
    connected: false,

    on (channel, fn)
    {
        if (!listeners.has(channel)) {
            listeners.set(channel, new Set());
        }

        listeners.get(channel).add(fn);
        this.reconnect();

        return () => {
            listeners.get(channel)?.delete(fn);
            if (listeners.get(channel)?.size === 0) {
                listeners.delete(channel);
            }

            this.reconnect();
        };
    },

    reconnect ()
    {
        const channels = [...listeners.keys()].sort().join(',');
        if (channels === channelsKey && source !== null) {
            return;
        }

        channelsKey = channels;
        if (source !== null) {
            source.close();
        }

        source = new EventSource('/api/live' + qs({ channels }));
        source.onopen = () => { this.connected = true; document.body.classList.remove('offline'); };
        source.onerror = () => { this.connected = false; document.body.classList.add('offline'); };

        for (const channel of ['chat', 'drops', 'trades', 'flags', 'support', 'status']) {
            source.addEventListener(channel, (event) => {
                let data = null;
                try {
                    data = JSON.parse(event.data);
                } catch {
                    return;
                }

                for (const fn of listeners.get(channel) ?? []) {
                    fn(data);
                }
            });
        }
    },

    close ()
    {
        source?.close();
        source = null;
        channelsKey = '';
    },
};

// ---------------------------------------------------------------------------------------------------------------------
// charts
// ---------------------------------------------------------------------------------------------------------------------

export const COLORS = ['#4ea8ff', '#f5b942', '#3ecf8e', '#ff6b6b', '#b48cff', '#5ad1d1', '#ff9f5a', '#9aa5b1'];

export function chart (canvas, config)
{
    const Chart = window.Chart;
    if (Chart === undefined || canvas === null) {
        return null;
    }

    Chart.defaults.color = '#9aa5b1';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11;
    Chart.defaults.animation = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;

    return new Chart(canvas, config);
}

/**
 * Sortable table: click on th[data-sort] sorts the rows array and calls render
 */
export function sortable (table, state, render)
{
    table.addEventListener('click', (event) => {
        const th = event.target.closest('th[data-sort]');
        if (th === null) {
            return;
        }

        const key = th.dataset.sort;
        state.dir = state.key === key && state.dir === 'desc' ? 'asc' : 'desc';
        state.key = key;
        render();
    });
}

export function sortRows (rows, state)
{
    const dir = state.dir === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
        const x = a[state.key];
        const y = b[state.key];
        if (typeof x === 'string' || typeof y === 'string') {
            return String(x ?? '').localeCompare(String(y ?? '')) * dir;
        }

        return ((x ?? -Infinity) - (y ?? -Infinity)) * dir;
    });
}

export function sortHeader (label, key, state, cls = '')
{
    const active = state.key === key;

    return html`<th data-sort="${key}" class="sortable ${cls} ${active ? 'sorted-' + state.dir : ''}">${label}</th>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Modal dialog with a form
 *
 * @param {{title:string, text?:string, body?:Raw|string, submit?:string, danger?:boolean, onSubmit?:(data:object, form:HTMLFormElement)=>Promise<any>}} options
 *
 * @return {Promise<object|null>} form data (or the result of onSubmit), null if cancelled
 */
export function dialog (options)
{
    return new Promise((resolve) => {
        const el = document.createElement('dialog');
        el.innerHTML = String(html`
            <form method="dialog" class="stack">
                <h2>${options.title}</h2>
                ${options.text ? html`<p class="muted" style="margin:0">${options.text}</p>` : ''}
                ${options.body ?? ''}
                <div class="buttons">
                    <button type="button" data-cancel>Cancel</button>
                    <button type="submit" class="${options.danger ? 'danger' : 'primary'}">${options.submit ?? 'OK'}</button>
                </div>
            </form>`);
        document.body.appendChild(el);

        const form = el.querySelector('form');
        let done = false;
        const finish = (value) => {
            if (done) {
                return;
            }

            done = true;
            el.close();
            el.remove();
            resolve(value);
        };

        el.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        el.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const data = formData(form);
            if (typeof options.onSubmit !== 'function') {
                finish(data);

                return;
            }

            const button = form.querySelector('[type=submit]');
            button.disabled = true;
            try {
                finish(await options.onSubmit(data, form) ?? data);
            } catch (error) {
                formErrors(form, error);
                button.disabled = false;
            }
        });

        options.onOpen?.(form);
        el.showModal();
        const first = form.querySelector('input, select, textarea');
        first?.focus();
    });
}
