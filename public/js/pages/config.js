import { html, $, $$, get, post, del, num, dateTime, toast, errorToast, formErrors, severityBadge } from '../core.js';

export async function render (view)
{
    let config = await get('/api/config');
    let words = await get('/api/config/words');
    let wordFilter = '';

    view.innerHTML = '';
    const root = document.createElement('div');
    view.appendChild(root);

    const draw = () => {
        const labels = Object.fromEntries(config.groups.flatMap((g) => g.items.map((i) => [i.key, i.label])));
        root.innerHTML = String(html`
            <div class="page">
                <div class="page-head">
                    <div><h1>Configuration</h1><div class="sub">Limits for the automatic detection of suspicious behavior. Changes are used by the next check (it starts right after saving).</div></div>
                </div>

                <form id="config-form">
                    <div class="grid cols-2">
                        <div>
                            ${config.groups.map((g) => html`
                                <div class="panel config-group">
                                    <h2>${g.group}</h2>
                                    ${g.items.map((i) => html`
                                        <div class="config-row">
                                            <div><b>${i.label}</b><div class="unit">${i.unit} · default ${i.default}</div></div>
                                            <div>
                                                <input type="number" name="${i.key}" value="${i.value}" ${i.min !== undefined ? html`min="${i.min}"` : ''} ${i.max !== undefined ? html`max="${i.max}"` : ''} step="${i.step ?? 'any'}" data-initial="${i.value}" required>
                                                ${i.updated ? html`<div class="changed">changed by ${i.updated.name ?? '?'}, ${dateTime(i.updated.time)}</div>` : ''}
                                            </div>
                                            <div class="help">${i.help}</div>
                                        </div>`)}
                                </div>`)}
                        </div>
                        <div>
                            <div class="panel config-group">
                                <h2>Rules</h2>
                                <p class="muted small">Disabled rules do not create new flags. Existing flags stay.</p>
                                ${config.rules.map((r) => html`
                                    <div class="config-row" style="grid-template-columns: 1fr auto">
                                        <div>
                                            <label class="switch"><input type="checkbox" name="rule.${r.id}" ${r.enabled ? 'checked' : ''} data-initial="${r.enabled ? '1' : '0'}"> <b>${r.label}</b></label>
                                            <div class="help">${r.help} · uses: ${r.thresholds.map((k) => labels[k] ?? k).join(', ')}</div>
                                        </div>
                                        <div>${severityBadge(r.severity)}</div>
                                    </div>`)}
                            </div>

                            <div class="panel config-group" id="words">
                                <div class="panel-head"><h2>Bad word list <span class="muted small">(${words.length})</span></h2><input type="search" id="word-filter" placeholder="Filter…" value="${wordFilter}" style="width:150px"></div>
                                <p class="muted small">Used for the highlighting in the chat and the rule “Offensive chat”. Level 1 words (red border) are severe.</p>
                                <div class="words">
                                    ${words.filter((w) => wordFilter === '' || String(w.word).includes(wordFilter)).map((w) => html`
                                        <span class="word level-${w.level ?? 0}" title="${w.language ?? ''} · level ${w.level ?? 0}">${w.word}<button type="button" data-remove-word="${w.id}" title="Remove">×</button></span>`)}
                                </div>
                                <div class="row" style="margin-top:10px" id="word-form">
                                    <input name="word" placeholder="New word" maxlength="60">
                                    <select name="level"><option value="0">Level 0</option><option value="1">Level 1 (severe)</option></select>
                                    <select name="language"><option value="en">en</option><option value="de">de</option></select>
                                    <button type="button" id="add-word">Add</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="panel row" style="position:sticky;bottom:0;justify-content:flex-end;margin-top:10px">
                        <span class="muted small" id="changes">No changes</span>
                        <button type="button" id="reset">Reset</button>
                        <button type="submit" class="primary">Save changes</button>
                    </div>
                </form>
            </div>`);

        if (location.hash === '#words') {
            $('#words', root).scrollIntoView();
        }

        updateChanges();
    };

    const changed = () => {
        const values = {};
        for (const input of $$('#config-form [data-initial]', root)) {
            const value = input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value;
            if (value !== input.dataset.initial) {
                values[input.name] = input.type === 'checkbox' ? input.checked : Number(value);
            }
        }

        return values;
    };

    const updateChanges = () => {
        const count = Object.keys(changed()).length;
        $('#changes', root).textContent = count === 0 ? 'No changes' : count + ' unsaved change(s)';
        $('#changes', root).className = count === 0 ? 'muted small' : 'warn small';
    };

    root.addEventListener('input', (event) => {
        if (event.target.id === 'word-filter') {
            wordFilter = event.target.value.trim().toLowerCase();
            const box = $('.words', root);
            box.innerHTML = String(html`${words.filter((w) => wordFilter === '' || String(w.word).includes(wordFilter)).map((w) => html`
                <span class="word level-${w.level ?? 0}" title="${w.language ?? ''} · level ${w.level ?? 0}">${w.word}<button type="button" data-remove-word="${w.id}" title="Remove">×</button></span>`)}`);

            return;
        }

        updateChanges();
    });

    root.addEventListener('change', updateChanges);

    root.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const values = changed();
        if (Object.keys(values).length === 0) {
            toast('Nothing to save', 'info');

            return;
        }

        try {
            const result = await post('/api/config', { values });
            toast(result.message);
            config = await get('/api/config');
            draw();
        } catch (error) {
            formErrors(form, error);
        }
    });

    root.addEventListener('click', async (event) => {
        if (event.target.id === 'reset') {
            draw();

            return;
        }

        if (event.target.id === 'add-word') {
            const box = $('#word-form', root);
            try {
                const result = await post('/api/config/words', {
                    word: $('[name=word]', box).value,
                    level: Number($('[name=level]', box).value),
                    language: $('[name=language]', box).value,
                });
                toast(result.message);
                words = await get('/api/config/words');
                draw();
                $('#words', root).scrollIntoView();
            } catch (error) {
                formErrors(box, error);
            }

            return;
        }

        const remove = event.target.closest('[data-remove-word]');
        if (remove) {
            try {
                const result = await del('/api/config/words/' + remove.dataset.removeWord);
                toast(result.message);
                words = words.filter((w) => String(w.id) !== remove.dataset.removeWord);
                remove.closest('.word').remove();
            } catch (error) {
                errorToast(error);
            }
        }
    });

    draw();
}

export { num };
