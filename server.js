/**
 * Tales of Souls - moderation tool
 *
 * Internal website for the team (not for players). No third party packages, only Node.js (>= 22.5).
 *
 *   node server.js
 *
 * Environment variables:
 *   HOST    Address to listen on (default 127.0.0.1 = only reachable from this computer)
 *   PORT    Port (default 8090)
 *   TOS_DB  Path to TalesOfSouls.db (default ../Website/TalesOfSouls.db)
 *   SECURE_COOKIE=1  Only send the session cookie over https (when it runs behind a https proxy)
 */
'use strict';

const http = require('node:http');
const path = require('node:path');

const { db: getDb } = require('./src/db');
const { migrate }   = require('./src/migrate');
const { Router, HttpError, sendJson, readJson, serveStatic, parseCookies, query } = require('./src/http');
const auth  = require('./src/auth');
const api   = require('./src/api');
const { Live } = require('./src/live');

const HOST   = process.env.HOST || '127.0.0.1';
const PORT   = parseInt(process.env.PORT || '8090', 10);
const PUBLIC = path.join(__dirname, 'public');
const SECURE = process.env.SECURE_COOKIE === '1';

const db = getDb();
const changes = migrate(db);
if (changes.length > 0) {
    console.log('Database migrated:\n  ' + changes.join('\n  '));
}

const live   = new Live(db);
const router = new Router();

const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Robots-Tag': 'noindex, nofollow',
};

// ---------------------------------------------------------------------------------------------------------------------
// sign in
// ---------------------------------------------------------------------------------------------------------------------

router.post('/api/login', ({ body, req, res }) => {
    const result = auth.signIn(db, body.name, body.password, req.socket.remoteAddress ?? '');
    if (!result.ok) {
        throw new HttpError(result.status, result.message);
    }

    res.setHeader('Set-Cookie', auth.cookie(result.token, SECURE));

    return { ok: true, account: result.account };
}, { auth: false });

router.post('/api/logout', ({ req, res }) => {
    auth.signOut(db, parseCookies(req.headers.cookie));
    res.setHeader('Set-Cookie', auth.cookie('', SECURE));

    return { ok: true };
});

router.get('/api/me', ({ user }) => ({ account: user.account, csrf: user.csrf }));

router.get('/api/live', ({ req, res, q }) => {
    live.connect(req, res, q.list('channels'));

    return undefined;
});

const detection = api.register(router, db, live);

// ---------------------------------------------------------------------------------------------------------------------
// request handling
// ---------------------------------------------------------------------------------------------------------------------

async function handle (req, res)
{
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
            res.setHeader(key, value);
        }

        // single page application: unknown paths load index.html
        if (req.method === 'GET' && (serveStatic(PUBLIC, pathname, res) || serveStatic(PUBLIC, '/index.html', res))) {
            return;
        }

        res.writeHead(404).end();

        return;
    }

    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(key, value);
    }

    const match = router.match(req.method, pathname);
    if (match === null) {
        sendJson(res, 404, { error: 'Not found' });

        return;
    }

    if (match === 'method') {
        sendJson(res, 405, { error: 'Method not allowed' });

        return;
    }

    const { route, params } = match;
    const user = auth.session(db, parseCookies(req.headers.cookie));

    if (route.options.auth && user === null) {
        sendJson(res, 401, { error: 'Please sign in' });

        return;
    }

    // CSRF: every change needs the token of the session in a header (and the cookie is SameSite=Strict)
    if (req.method !== 'GET' && route.options.auth && req.headers['x-csrf-token'] !== user.csrf) {
        sendJson(res, 403, { error: 'Invalid CSRF token, please reload the page' });

        return;
    }

    const body = req.method === 'POST' ? await readJson(req) : {};
    const result = await route.handler({ req, res, params, body, user, q: query(url), url });

    if (result !== undefined && !res.headersSent) {
        sendJson(res, 200, result);
    }
}

const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
        if (error instanceof HttpError) {
            sendJson(res, error.status, { error: error.message, fields: error.data ?? undefined });

            return;
        }

        console.error(new Date().toISOString(), req.method, req.url, error);
        if (!res.headersSent) {
            sendJson(res, 500, { error: 'Internal error: ' + error.message });
        } else {
            res.end();
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log('Tales of Souls moderation: http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT);
    console.log('Database: ' + db.file);
    detection.scheduleDetection();
});

const shutdown = () => {
    detection.stop();
    live.stop();
    server.close(() => {
        db.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
