/**
 * Minimal HTTP helpers: router, JSON responses, request body, static files
 */
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

class HttpError extends Error
{
    constructor (status, message, data = null)
    {
        super(message);
        this.status = status;
        this.data   = data;
    }
}

class Router
{
    constructor ()
    {
        this.routes = [];
    }

    /**
     * @param {string} method
     * @param {string} pattern e.g. /api/players/:id
     * @param {Function} handler (ctx) => result
     * @param {{auth?:boolean}} options
     */
    add (method, pattern, handler, options = {})
    {
        const keys = [];
        const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, key) => {
            keys.push(key);

            return '([^/]+)';
        }) + '$');

        this.routes.push({ method, regex, keys, handler, options: { auth: true, ...options } });
    }

    get (pattern, handler, options) { this.add('GET', pattern, handler, options); }
    post (pattern, handler, options) { this.add('POST', pattern, handler, options); }
    delete (pattern, handler, options) { this.add('DELETE', pattern, handler, options); }

    match (method, pathname)
    {
        let allowed = false;
        for (const route of this.routes) {
            const m = route.regex.exec(pathname);
            if (m === null) {
                continue;
            }

            if (route.method !== method) {
                allowed = true;
                continue;
            }

            const params = {};
            route.keys.forEach((key, i) => {
                params[key] = decodeURIComponent(m[i + 1]);
            });

            return { route, params };
        }

        return allowed ? 'method' : null;
    }
}

function sendJson (res, status, data, headers = {})
{
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        ...headers,
    });
    res.end(body);
}

/**
 * Read a JSON body (max 1 MB)
 */
function readJson (req)
{
    return new Promise((resolve, reject) => {
        const type = String(req.headers['content-type'] ?? '');
        if (!type.startsWith('application/json')) {
            reject(new HttpError(415, 'Content-Type must be application/json'));

            return;
        }

        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
                reject(new HttpError(413, 'Request too large'));
                req.destroy();

                return;
            }

            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});

                return;
            }

            try {
                const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                resolve(data !== null && typeof data === 'object' ? data : {});
            } catch {
                reject(new HttpError(400, 'Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve a file of the public directory
 *
 * @return {boolean} false if the file does not exist
 */
function serveStatic (root, pathname, res, headers = {})
{
    let file;
    try {
        file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    } catch {
        return false;
    }

    if (!file.startsWith(root + path.sep) && file !== root) {
        return false;
    }

    let stat;
    try {
        stat = fs.statSync(file);
        if (stat.isDirectory()) {
            file = path.join(file, 'index.html');
            stat = fs.statSync(file);
        }
    } catch {
        return false;
    }

    res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': file.includes(path.sep + 'vendor' + path.sep) ? 'public, max-age=604800' : 'no-cache',
        ...headers,
    });
    fs.createReadStream(file).pipe(res);

    return true;
}

function parseCookies (header)
{
    const out = {};
    for (const part of String(header ?? '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0) {
            out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        }
    }

    return out;
}

/**
 * Query parameter helpers
 */
function query (url)
{
    const params = url.searchParams;

    return {
        str: (key, fallback = '') => (params.get(key) ?? fallback).trim(),
        int: (key, fallback = null, min = -Infinity, max = Infinity) => {
            const value = parseInt(params.get(key) ?? '', 10);

            return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
        },
        list: (key) => (params.get(key) ?? '').split(',').map((v) => v.trim()).filter((v) => v !== ''),
    };
}

module.exports = { Router, HttpError, sendJson, readJson, serveStatic, parseCookies, query };
