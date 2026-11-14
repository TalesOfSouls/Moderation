/**
 * Moderation tool: layout, sign in, navigation
 */
import { html, $, $$, api, get, post, session, live, toast, errorToast, esc, accountLink, characterLink } from './core.js';

const ROUTES = [
    [/^\/$/, 'dashboard', 'dashboard'],
    [/^\/flags$/, 'flags', 'flags'],
    [/^\/rankings$/, 'rankings', 'rankings'],
    [/^\/chat$/, 'chat', 'chat'],
    [/^\/drops$/, 'drops', 'drops'],
    [/^\/trades$/, 'trades', 'trades'],
    [/^\/players$/, 'players', 'players'],
    [/^\/players\/(\d+)$/, 'player', 'players'],
    [/^\/characters\/(\d+)$/, 'character', 'players'],
    [/^\/support$/, 'support', 'support'],
    [/^\/support\/(\d+)$/, 'support', 'support'],
    [/^\/config$/, 'config', 'config'],
    [/^\/reports$/, 'reports', 'reports'],
    [/^\/guilds\/(\d+)$/, 'guild', 'players'],
    [/^\/items$/, 'items', 'items'],
    [/^\/encounters$/, 'encounters', 'encounters'],
    [/^\/encounters\/(\d+)$/, 'encounter', 'encounters'],
    [/^\/log$/, 'log', 'log'],
];

const NAV = [
    ['/', 'dashboard', 'Dashboard', 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z'],
    ['/flags', 'flags', 'Suspicious activity', 'M4 21V4h11l1 2h5v10h-7l-1-2H6v7z'],
    ['/rankings', 'rankings', 'Rankings', 'M4 20h4V10H4zm6 0h4V4h-4zm6 0h4v-7h-4z'],
    ['/chat', 'chat', 'Live chat', 'M4 4h16v12H7l-3 3z'],
    ['/drops', 'drops', 'Live drops', 'M12 3l7 4v10l-7 4-7-4V7z'],
    ['/encounters', 'encounters', 'Instances & matches', 'M5 4h14v4l-3 3 3 3v6H5v-6l3-3-3-3z'],
    ['/trades', 'trades', 'Trades', 'M7 7h11l-3-3m3 3l-3 3M17 17H6l3 3m-3-3l3-3'],
    ['/reports', 'reports', 'Player reports', 'M12 3l9 16H3zm0 6v4m0 3v.5'],
    ['/players', 'players', 'Players', 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9c0-4 4-6 8-6s8 2 8 6z'],
    ['/items', 'items', 'Item trace', 'M4 8l8-4 8 4-8 4zm0 0v8l8 4 8-4V8m-8 4v8'],
    ['/support', 'support', 'Player support', 'M4 5h16v11H9l-5 4z'],
    ['/config', 'config', 'Configuration', 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.5 4l2-1.5-2-3.5-2.4.8a7 7 0 00-1.8-1L16 4h-4l-.3 2.8a7 7 0 00-1.8 1L7.5 7 5.5 10.5l2 1.5a7 7 0 000 2l-2 1.5 2 3.5 2.4-.8a7 7 0 001.8 1L12 22h4l.3-2.8a7 7 0 001.8-1l2.4.8 2-3.5-2-1.5a7 7 0 000-2z'],
    ['/log', 'log', 'Moderation log', 'M5 3h11l3 3v15H5zm3 6h8M8 13h8m-8 4h5'],
];

let cleanup = null;
let current = '';

// ---------------------------------------------------------------------------------------------------------------------
// sign in
// ---------------------------------------------------------------------------------------------------------------------

function renderLogin (message = '')
{
    live.close();
    $('#app').innerHTML = String(html`
        <div class="login">
            <form class="login-box" id="login-form" autocomplete="on">
                <div class="login-title">
                    <img src="/favicon.svg" alt="" width="36" height="36">
                    <div><strong>Tales of Souls</strong><span>Moderation</span></div>
                </div>
                <p class="muted small">Sign in with a team account (developer or administrator) of the website.</p>
                <label>Account<input name="name" autocomplete="username" required autofocus></label>
                <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
                <div class="login-error" role="alert">${message}</div>
                <button class="primary" type="submit">Sign in</button>
            </form>
        </div>`);

    $('#login-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = $('button', form);
        button.disabled = true;

        try {
            await post('/api/login', { name: form.name.value, password: form.password.value });
            await start();
        } catch (error) {
            $('.login-error', form).textContent = error.message;
            button.disabled = false;
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------------------------------

function icon (path)
{
    return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

function renderLayout ()
{
    $('#app').innerHTML = String(html`
        <aside class="sidebar">
            <a class="brand" href="/"><img src="/favicon.svg" alt="" width="26" height="26"><span>ToS <b>Moderation</b></span></a>
            <nav>
                ${NAV.map(([href, key, label, path]) => html`
                    <a href="${href}" data-nav="${key}">${icon(path)}<span>${label}</span><em class="count" data-count="${key}"></em></a>`)}
            </nav>
            <div class="sidebar-foot">
                <div class="live-state"><i></i><span>Live</span></div>
                <div class="online" data-online>- online</div>
            </div>
        </aside>
        <div class="main">
            <header class="topbar">
                <div class="search">
                    <input type="search" id="global-search" placeholder="Search account, character, guild, e-mail, id or item id…" autocomplete="off">
                    <div class="search-results" id="search-results" hidden></div>
                </div>
                <div class="user">
                    <span>${session.account.name}</span>
                    <button class="ghost small" id="logout">Sign out</button>
                </div>
            </header>
            <main id="view"></main>
        </div>`);

    $('#logout').addEventListener('click', async () => {
        try {
            await post('/api/logout');
        } catch {
            // signed out anyway
        }

        session.account = null;
        renderLogin();
    });

    // global search
    const input = $('#global-search');
    const results = $('#search-results');
    let timer = null;
    let selected = -1;

    const close = () => { results.hidden = true; selected = -1; };

    input.addEventListener('input', () => {
        clearTimeout(timer);
        const value = input.value.trim();
        if (value === '') {
            close();

            return;
        }

        timer = setTimeout(async () => {
            try {
                const data = await get('/api/search?q=' + encodeURIComponent(value));
                if (input.value.trim() !== value) {
                    return;
                }

                results.innerHTML = String(html`
                    ${data.accounts.length > 0 ? html`<div class="group">Accounts</div>` : ''}
                    ${data.accounts.map((a) => html`<a href="/players/${a.id}"><b>${a.name}</b> <span class="muted">#${a.id} ${a.email ?? ''}</span>${a.status === 2 ? html` <span class="badge sev-3">banned</span>` : ''}</a>`)}
                    ${data.characters.length > 0 ? html`<div class="group">Characters</div>` : ''}
                    ${data.characters.map((c) => html`<a href="/characters/${c.id}"><b>${c.name}</b> <span class="muted">lvl ${c.level} ${c.className ?? ''} · ${c.accountName ?? ''}</span></a>`)}
                    ${data.guilds.length > 0 ? html`<div class="group">Guilds</div>` : ''}
                    ${data.guilds.map((g) => html`<a href="/guilds/${g.id}"><b>${g.name}</b> <span class="muted">${g.tag ? '[' + g.tag + ']' : ''}</span></a>`)}
                    ${data.items.length > 0 ? html`<div class="group">Items</div>` : ''}
                    ${data.items.map((i) => html`<a href="/items?uid=${i.uid}"><b>${i.name}</b> <span class="muted mono">${i.uid}</span></a>`)}
                    ${data.accounts.length + data.characters.length + data.guilds.length + data.items.length === 0 ? html`<div class="empty">Nothing found</div>` : ''}`);
                results.hidden = false;
            } catch (error) {
                errorToast(error);
            }
        }, 200);
    });

    input.addEventListener('keydown', (event) => {
        const links = $$('a', results);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            selected = Math.max(0, Math.min(links.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
            links.forEach((l, i) => l.classList.toggle('active', i === selected));
        } else if (event.key === 'Enter' && links.length > 0) {
            event.preventDefault();
            navigate((links[selected] ?? links[0]).getAttribute('href'));
            input.value = '';
            close();
        } else if (event.key === 'Escape') {
            close();
        }
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.search')) {
            close();
        } else if (event.target.closest('#search-results a')) {
            input.value = '';
            close();
        }
    });

    live.on('status', updateCounters);
}

function updateCounters (status)
{
    const flags = $('[data-count="flags"]');
    const support = $('[data-count="support"]');
    const trades = $('[data-count="trades"]');

    if (flags) {
        flags.textContent = status.flags > 0 ? status.flags : '';
        flags.classList.toggle('alert', status.highFlags > 0);
    }

    if (support) {
        support.textContent = status.unread > 0 ? status.unread : '';
        support.classList.toggle('alert', status.unread > 0);
    }

    if (trades) {
        trades.textContent = status.openTrades > 0 ? status.openTrades : '';
    }

    const reports = $('[data-count="reports"]');
    if (reports) {
        reports.textContent = status.openReports > 0 ? status.openReports : '';
    }

    const online = $('[data-online]');
    if (online) {
        online.textContent = status.online + ' online';
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------------------------------------------------

export function navigate (url, replace = false)
{
    if (replace) {
        history.replaceState(null, '', url);
    } else {
        history.pushState(null, '', url);
    }

    route();
}

async function route ()
{
    const path = location.pathname;
    const match = ROUTES.map(([regex, page, nav]) => ({ m: regex.exec(path), page, nav })).find((r) => r.m !== null);

    $$('[data-nav]').forEach((a) => a.classList.toggle('active', match !== undefined && a.dataset.nav === match.nav));

    if (typeof cleanup === 'function') {
        try {
            cleanup();
        } catch {
            // ignore
        }
    }

    cleanup = null;
    const view = $('#view');
    if (view === null) {
        return;
    }

    if (match === undefined) {
        view.innerHTML = String(html`<div class="page"><h1>Not found</h1><p><a href="/">Back to the dashboard</a></p></div>`);

        return;
    }

    const key = path + location.search;
    current = key;
    view.innerHTML = '<div class="page loading">Loading…</div>';

    try {
        const module = await import('./pages/' + match.page + '.js');
        if (current !== key) {
            return;
        }

        cleanup = await module.render(view, match.m.slice(1), new URLSearchParams(location.search));
        window.scrollTo(0, 0);
    } catch (error) {
        console.error(error);
        if (current === key) {
            view.innerHTML = String(html`<div class="page"><div class="error-box">${error.message}</div></div>`);
        }
    }
}

document.addEventListener('click', (event) => {
    // click on a chat message: show the conversation around it
    const message = event.target.closest('[data-chat-context]');
    if (message !== null && event.target.closest('a, button') === null) {
        import('./chatcontext.js').then((m) => m.openConversation(Number(message.dataset.chatContext))).catch(errorToast);

        return;
    }

    const link = event.target.closest('a[href]');
    if (link === null || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || link.target === '_blank') {
        return;
    }

    const href = link.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) {
        return;
    }

    event.preventDefault();
    navigate(href);
});

window.addEventListener('popstate', route);
window.addEventListener('signed-out', () => {
    if (session.account !== null) {
        session.account = null;
        renderLogin('Your session has expired, please sign in again.');
    }
});

async function start ()
{
    try {
        const me = await get('/api/me');
        session.account = me.account;
        session.csrf = me.csrf;
    } catch {
        renderLogin();

        return;
    }

    renderLayout();
    await route();
}

start();

export { esc, accountLink, characterLink, api, toast };
