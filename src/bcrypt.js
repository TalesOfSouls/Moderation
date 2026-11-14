/**
 * bcrypt password verification without third party libraries
 *
 * The website (PHP password_hash) stores bcrypt hashes ($2y$10$...). Node has no bcrypt in its crypto module,
 * so this file implements the algorithm (eksblowfish). The Blowfish start values are the hex digits of pi,
 * they are calculated once instead of being pasted as 1042 constants.
 */
'use strict';

const crypto = require('node:crypto');

const BASE64 = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAGIC  = Buffer.from('OrpheanBeholderScryDoubt', 'latin1');

let PI_WORDS = null;

/**
 * First 1042 32-bit words of the fractional part of pi (18 P-array + 4 * 256 S-box words)
 *
 * pi = 16 * atan(1/5) - 4 * atan(1/239) (Machin), calculated with BigInt fixed point numbers
 *
 * @return {Uint32Array}
 */
function piWords ()
{
    if (PI_WORDS !== null) {
        return PI_WORDS;
    }

    const words = 18 + 1024;
    const bits  = BigInt(words * 32 + 64);
    const one   = 1n << bits;

    const atanInv = function (x) {
        const x2  = x * x;
        let term  = one / x;
        let sum   = term;
        let n     = 1n;
        let sign  = -1n;

        while (term !== 0n) {
            term /= x2;
            n    += 2n;
            sum  += sign * (term / n);
            sign  = -sign;
        }

        return sum;
    };

    const pi   = 16n * atanInv(5n) - 4n * atanInv(239n);
    let frac   = pi & (one - 1n); // drop the 3
    const out  = new Uint32Array(words);
    const mask = (1n << 32n) - 1n;

    for (let i = 0; i < words; ++i) {
        frac  <<= 32n;
        out[i] = Number((frac >> bits) & mask);
        frac  &= one - 1n;
    }

    PI_WORDS = out;

    return out;
}

/**
 * Read a 32 bit word (big endian) from a byte array that is used as a ring buffer
 *
 * @param {Buffer} data Data
 * @param {{pos:number}} cursor Read position
 *
 * @return {number}
 */
function streamWord (data, cursor)
{
    let word = 0;
    for (let i = 0; i < 4; ++i) {
        word = ((word << 8) | data[cursor.pos]) >>> 0;
        cursor.pos = (cursor.pos + 1) % data.length;
    }

    return word;
}

class Blowfish
{
    constructor ()
    {
        const pi = piWords();
        this.P   = Uint32Array.from(pi.subarray(0, 18));
        this.S   = Uint32Array.from(pi.subarray(18));
    }

    F (x)
    {
        const S = this.S;

        return ((((S[x >>> 24] + S[256 | ((x >>> 16) & 0xff)]) >>> 0) ^ S[512 | ((x >>> 8) & 0xff)]) + S[768 | (x & 0xff)]) >>> 0;
    }

    encipher (lr, off)
    {
        const P = this.P;
        let l   = lr[off];
        let r   = lr[off + 1];

        l = (l ^ P[0]) >>> 0;
        for (let i = 0; i <= 14; i += 2) {
            r = (r ^ this.F(l) ^ P[i + 1]) >>> 0;
            l = (l ^ this.F(r) ^ P[i + 2]) >>> 0;
        }

        lr[off]     = (r ^ P[17]) >>> 0;
        lr[off + 1] = l;
    }

    /**
     * Key schedule, with salt (eksblowfish) or without (salt = null)
     */
    expand (key, salt)
    {
        const P = this.P;
        const S = this.S;
        const k = { pos: 0 };
        const s = { pos: 0 };
        const lr = new Uint32Array(2);

        for (let i = 0; i < 18; ++i) {
            P[i] = (P[i] ^ streamWord(key, k)) >>> 0;
        }

        for (let i = 0; i < 18; i += 2) {
            if (salt !== null) {
                lr[0] ^= streamWord(salt, s);
                lr[1] ^= streamWord(salt, s);
            }

            this.encipher(lr, 0);
            P[i]     = lr[0];
            P[i + 1] = lr[1];
        }

        for (let i = 0; i < 1024; i += 2) {
            if (salt !== null) {
                lr[0] ^= streamWord(salt, s);
                lr[1] ^= streamWord(salt, s);
            }

            this.encipher(lr, 0);
            S[i]     = lr[0];
            S[i + 1] = lr[1];
        }
    }
}

function encode64 (bytes, length)
{
    let out = '';
    let i   = 0;

    while (i < length) {
        let c1 = bytes[i++] & 0xff;
        out += BASE64[(c1 >> 2) & 0x3f];
        c1 = (c1 & 0x03) << 4;
        if (i >= length) {
            out += BASE64[c1 & 0x3f];
            break;
        }

        let c2 = bytes[i++] & 0xff;
        c1 |= (c2 >> 4) & 0x0f;
        out += BASE64[c1 & 0x3f];
        c1 = (c2 & 0x0f) << 2;
        if (i >= length) {
            out += BASE64[c1 & 0x3f];
            break;
        }

        c2 = bytes[i++] & 0xff;
        c1 |= (c2 >> 6) & 0x03;
        out += BASE64[c1 & 0x3f];
        out += BASE64[c2 & 0x3f];
    }

    return out;
}

function decode64 (text, length)
{
    const out = [];
    const val = (c) => BASE64.indexOf(c);
    let i = 0;

    while (i < text.length - 1 && out.length < length) {
        const c1 = val(text[i++]);
        const c2 = val(text[i++]);
        if (c1 < 0 || c2 < 0) {
            break;
        }

        out.push(((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff);
        if (out.length >= length || i >= text.length) {
            break;
        }

        const c3 = val(text[i++]);
        if (c3 < 0) {
            break;
        }

        out.push((((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff);
        if (out.length >= length || i >= text.length) {
            break;
        }

        const c4 = val(text[i++]);
        out.push((((c3 & 0x03) << 6) | c4) & 0xff);
    }

    return Buffer.from(out);
}

/**
 * Calculate a bcrypt hash
 *
 * @param {string} password Password
 * @param {string} setting  "$2y$10$" + 22 salt characters
 *
 * @return {string|null}
 */
function hash (password, setting)
{
    const match = /^\$2([abxy])\$(\d\d)\$([./A-Za-z0-9]{22})/.exec(setting);
    if (match === null) {
        return null;
    }

    const cost = parseInt(match[2], 10);
    if (cost < 4 || cost > 20) {
        return null;
    }

    const salt = decode64(match[3], 16);
    let key    = Buffer.concat([Buffer.from(password, 'utf8'), Buffer.from([0])]);
    if (key.length > 72) {
        key = key.subarray(0, 72);
    }

    const bf = new Blowfish();
    bf.expand(key, salt);

    for (let i = 0, rounds = 1 << cost; i < rounds; ++i) {
        bf.expand(key, null);
        bf.expand(salt, null);
    }

    const data = new Uint32Array(6);
    for (let i = 0; i < 6; ++i) {
        data[i] = MAGIC.readUInt32BE(i * 4);
    }

    for (let i = 0; i < 64; ++i) {
        for (let j = 0; j < 6; j += 2) {
            bf.encipher(data, j);
        }
    }

    const bytes = Buffer.alloc(24);
    for (let i = 0; i < 6; ++i) {
        bytes.writeUInt32BE(data[i], i * 4);
    }

    return '$2' + match[1] + '$' + match[2] + '$' + encode64(salt, 16) + encode64(bytes, 23);
}

/**
 * Check a password against a stored bcrypt hash (constant time compare)
 *
 * @param {string} password Password
 * @param {string} stored   Stored hash
 *
 * @return {boolean}
 */
function verify (password, stored)
{
    if (typeof stored !== 'string' || stored.length !== 60) {
        return false;
    }

    const calculated = hash(password, stored);
    if (calculated === null) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(stored));
}

module.exports = { hash, verify, piWords };
