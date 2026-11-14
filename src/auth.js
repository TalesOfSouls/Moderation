/**
 * Moderator sign in
 *
 * Moderators sign in with their website account (same password). Only accounts with the role developer (1) or
 * admin (2) and the status active have access. Sessions are stored in mod_session (survive restarts).
 */
'use strict';

const crypto = require('node:crypto');
const bcrypt = require('./bcrypt');
const { now } = require('./util');

const COOKIE   = 'tos_mod';
const LIFETIME = 12 * 3600;
const MIN_ROLE = 1;

/** failed sign ins per ip (simple brute force protection) */
const failures = new Map();

function token ()
{
    return crypto.randomBytes(32).toString('base64url');
}

function hashToken (value)
{
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * @param {import('./db').Database} db
 * @param {string} name
 * @param {string} password
 * @param {string} ip
 *
 * @return {{ok:true, token:string, account:object}|{ok:false, message:string, status:number}}
 */
function signIn (db, name, password, ip)
{
    const t = now();
    const fail = failures.get(ip) ?? { count: 0, until: 0 };

    if (fail.until > t) {
        return { ok: false, status: 429, message: 'Too many failed attempts, try again in ' + Math.ceil((fail.until - t) / 60) + ' minute(s).' };
    }

    const account = db.get(
        'SELECT account_id AS id, account_name AS name, account_password AS password, account_role AS role, account_status AS status FROM account WHERE account_name = ? COLLATE NOCASE',
        String(name ?? '').trim()
    );

    // always calculate a hash, so the response time does not tell if the account exists
    const valid = bcrypt.verify(String(password ?? ''), account?.password ?? '$2y$10$abcdefghijklmnopqrstuuJ4vXsqqhUlr8gyN1bv9KFmY.fX6kw7e');

    if (account === null || !valid) {
        fail.count++;
        if (fail.count >= 5) {
            fail.until = t + 5 * 60;
            fail.count = 0;
        }

        failures.set(ip, fail);

        return { ok: false, status: 401, message: 'Wrong account name or password.' };
    }

    if (account.role < MIN_ROLE || account.status !== 1) {
        return { ok: false, status: 403, message: 'This account has no access to the moderation tool.' };
    }

    failures.delete(ip);

    const value = token();
    db.run('DELETE FROM mod_session WHERE mod_session_expires < ?', t);
    db.run(
        'INSERT INTO mod_session (mod_session_token, mod_session_account, mod_session_csrf, mod_session_created, mod_session_expires) VALUES (?, ?, ?, ?, ?)',
        hashToken(value), account.id, token(), t, t + LIFETIME
    );

    return { ok: true, token: value, account: { id: account.id, name: account.name, role: account.role } };
}

/**
 * Session of a request
 *
 * @return {{account:{id:number, name:string, role:number}, csrf:string}|null}
 */
function session (db, cookies)
{
    const value = cookies[COOKIE];
    if (typeof value !== 'string' || value.length < 20) {
        return null;
    }

    const row = db.get(
        `SELECT s.mod_session_csrf AS csrf, s.mod_session_expires AS expires, a.account_id AS id, a.account_name AS name, a.account_role AS role,
                a.account_status AS status
         FROM mod_session s JOIN account a ON a.account_id = s.mod_session_account
         WHERE s.mod_session_token = ?`,
        hashToken(value)
    );

    // the role could have been removed on the website in the meantime
    if (row === null || row.expires < now() || row.role < MIN_ROLE || row.status !== 1) {
        return null;
    }

    return { account: { id: row.id, name: row.name, role: row.role }, csrf: row.csrf };
}

function signOut (db, cookies)
{
    const value = cookies[COOKIE];
    if (typeof value === 'string') {
        db.run('DELETE FROM mod_session WHERE mod_session_token = ?', hashToken(value));
    }
}

function cookie (value, secure)
{
    return COOKIE + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '')
        + (value === '' ? '; Max-Age=0' : '; Max-Age=' + LIFETIME);
}

module.exports = { signIn, signOut, session, cookie };
