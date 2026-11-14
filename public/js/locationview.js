/**
 * Current location of a character (instance / zone / position)
 */
import { html, ago, dateTime, num, COLORS } from './core.js';
import { TYPE_NAME } from './pages/encounters.js';

/**
 * Short text, e.g. for tables: "Sunken Crypt (Dungeon)" or "Ironpeak Mines"
 */
export function locationText (l)
{
    if (l === null || l === undefined) {
        return html`<span class="muted">-</span>`;
    }

    if (l.instance) {
        return html`<a href="/encounters/${l.instance.id}" class="nowrap"><span class="badge type-${l.instance.type}">${TYPE_NAME[l.instance.type] ?? l.instance.type}</span> ${l.instance.name ?? ''}</a>`;
    }

    if (l.zone) {
        return html`<span class="nowrap">${l.zone.name}</span>${l.stale ? html` <span class="muted small" title="no new position for ${ago(l.time)}">(${ago(l.time)})</span>` : ''}`;
    }

    return html`<span class="muted">unknown</span>`;
}

export function locationPanel (l, character)
{
    return html`
        <div class="panel location-panel" data-location>
            <div class="panel-head" style="margin-bottom:6px">
                <h3 style="margin:0">${l.online ? 'Current location' : 'Last known location'}</h3>
                ${l.online ? html`<span class="badge online">online ${ago(l.session.start).replace(' ago', '')}</span>` : html`<span class="badge">offline</span>`}
            </div>
            <div class="location-body">
                <dl class="facts">
                    ${l.instance ? html`
                        <dt>Instance</dt>
                        <dd><a href="/encounters/${l.instance.id}"><span class="badge type-${l.instance.type}">${TYPE_NAME[l.instance.type] ?? l.instance.type}</span> ${l.instance.name ?? '#' + l.instance.id}</a>
                            <div class="small muted">${l.instance.mode ?? l.instance.difficulty ?? ''}${l.instance.team ? ' · team ' + l.instance.team : ''} · since ${ago(l.instance.start).replace(' ago', '')}</div></dd>` : ''}
                    <dt>${l.instance ? 'Last zone' : 'Zone'}</dt>
                    <dd>${l.zone ? html`<a href="/chat?zone=${l.zone.id}" title="Chat of this zone">${l.zone.name}</a>` : html`<span class="muted">unknown</span>`}</dd>
                    <dt>Position</dt>
                    <dd>${l.x !== null ? html`<span class="mono">${num(l.x)}, ${num(l.y)}</span> <a href="/characters/${character}#path" class="small">route</a>` : html`<span class="muted">-</span>`}</dd>
                    <dt>Server</dt><dd>${l.server ?? '-'}</dd>
                    <dt>Updated</dt>
                    <dd>${l.time ? html`<span class="${l.stale ? 'warn' : ''}" title="${dateTime(l.time)}">${ago(l.time)}</span>${l.source === 'activity' ? html` <span class="small muted">(from chat/loot, no positions)</span>` : ''}` : '-'}
                        ${l.stale ? html`<div class="small warn">no new position from the game for a while</div>` : ''}</dd>
                    ${!l.instance && l.lastInstance ? html`
                        <dt>Last instance</dt>
                        <dd><a href="/encounters/${l.lastInstance.id}">${l.lastInstance.name ?? '#' + l.lastInstance.id}</a> <span class="small muted">${ago(l.lastInstance.start)}</span></dd>` : ''}
                </dl>
                ${l.trail && l.trail.length > 0 ? html`<canvas class="minimap" width="160" height="160" title="Last positions in ${l.zone?.name ?? 'the zone'}"></canvas>` : ''}
            </div>
        </div>`;
}

/**
 * Small map of the zone with the last positions (zone coordinates 0 - 1000)
 */
export function drawMinimap (root, l)
{
    const canvas = root.querySelector('.minimap');
    if (canvas === null || !l.trail || l.trail.length === 0) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const max = Math.max(1000, ...l.trail.map((p) => Math.max(p.x, p.y)));
    const s = (v) => 8 + v / max * (size - 16);

    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i <= 4; ++i) {
        ctx.beginPath();
        ctx.moveTo(s(i * max / 4), s(0));
        ctx.lineTo(s(i * max / 4), s(max));
        ctx.moveTo(s(0), s(i * max / 4));
        ctx.lineTo(s(max), s(i * max / 4));
        ctx.stroke();
    }

    ctx.strokeStyle = COLORS[0];
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    l.trail.forEach((p, i) => (i === 0 ? ctx.moveTo(s(p.x), s(p.y)) : ctx.lineTo(s(p.x), s(p.y))));
    ctx.stroke();
    ctx.globalAlpha = 1;

    const last = l.trail.at(-1);
    ctx.fillStyle = l.online && !l.stale ? COLORS[2] : COLORS[7];
    ctx.beginPath();
    ctx.arc(s(last.x), s(last.y), 5, 0, Math.PI * 2);
    ctx.fill();
}
