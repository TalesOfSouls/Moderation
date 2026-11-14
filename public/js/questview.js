/**
 * Quests of a character: mark quests or single steps as completed (or reset them)
 */
import { html, get, post, dateTime, dialog, toast, errorToast } from './core.js';

const STATUS_CLASS = { completed: 'completed', active: 'open', 'not started': '', abandoned: 'cancelled' };

/**
 * @param {HTMLElement} target
 * @param {number} character
 */
export async function renderQuests (target, character)
{
    const box = document.createElement('div');
    target.replaceChildren(box);

    let filter = 'started';
    let data = null;

    const load = async () => {
        data = await get('/api/quests/' + character);
        draw();
    };

    const draw = () => {
        const list = data.quests.filter((q) => filter === 'all' || (filter === 'started' ? q.status !== 'not started' : q.status === filter));

        box.innerHTML = String(html`
            <div class="filters">
                <div class="toggle">
                    ${[['started', 'Started'], ['active', 'Active'], ['completed', 'Completed'], ['all', 'All quests']].map(([k, l]) => html`<button type="button" data-qfilter="${k}" class="${filter === k ? 'active' : ''}">${l}</button>`)}
                </div>
                <span class="small muted">Completing a step also completes the steps before it. When all steps are done the quest is completed.</span>
            </div>
            <div class="grid cols-2">
                ${list.map((q) => html`
                    <div class="panel">
                        <div class="panel-head">
                            <h2>${q.title} <span class="badge ${STATUS_CLASS[q.status] ?? ''}">${q.status}</span></h2>
                            <div class="row">
                                ${q.status !== 'completed' ? html`<button class="small success" data-quest="${q.id}" data-done="1">Complete quest</button>` : ''}
                                ${q.status !== 'not started' ? html`<button class="small ghost" data-quest="${q.id}" data-done="0">Reset</button>` : ''}
                            </div>
                        </div>
                        <div class="small muted" style="margin-bottom:6px">${q.started ? 'started ' + dateTime(q.started) : 'not started'}${q.completed ? ' · completed ' + dateTime(q.completed) : ''}</div>
                        <table>
                            <tbody>
                                ${q.steps.map((s) => html`<tr>
                                    <td class="muted">${s.position}.</td>
                                    <td>${s.completed ? html`<span class="ok">✓</span> ` : ''}${s.title ?? 'Step ' + s.position}
                                        ${s.moderatorName ? html`<div class="small warn">completed by ${s.moderatorName}</div>` : ''}</td>
                                    <td class="num nowrap">${s.target > 1 ? s.progress + ' / ' + s.target : ''}</td>
                                    <td class="nowrap right">${s.completed
                                        ? html`<button class="small ghost" data-quest="${q.id}" data-step="${s.id}" data-done="0">Reset</button>`
                                        : html`<button class="small" data-quest="${q.id}" data-step="${s.id}" data-done="1">Complete</button>`}</td>
                                </tr>`)}
                                ${q.steps.length === 0 ? html`<tr class="empty-row"><td>No steps defined</td></tr>` : ''}
                            </tbody>
                        </table>
                    </div>`)}
                ${list.length === 0 ? html`<div class="panel muted">No quests</div>` : ''}
            </div>`);
    };

    box.addEventListener('click', async (event) => {
        const filterButton = event.target.closest('[data-qfilter]');
        if (filterButton) {
            filter = filterButton.dataset.qfilter;
            draw();

            return;
        }

        const button = event.target.closest('[data-quest]');
        if (button === null) {
            return;
        }

        const quest = data.quests.find((q) => q.id === Number(button.dataset.quest));
        const step = button.dataset.step ? quest.steps.find((s) => s.id === Number(button.dataset.step)) : null;
        const done = button.dataset.done === '1';
        const what = step ? 'step "' + step.title + '"' : 'quest "' + quest.title + '"';

        try {
            await dialog({
                title: (done ? 'Complete ' : 'Reset ') + what,
                text: done ? 'The progress is set as if the character had done it in the game.' : 'The progress is set back to 0.',
                body: html`<label>Reason <textarea name="reason" maxlength="500" required placeholder="e.g. quest item lost after a disconnect"></textarea></label>`,
                submit: done ? 'Complete' : 'Reset',
                danger: !done,
                onSubmit: async (values) => {
                    const result = await post('/api/quests/' + character, { quest: quest.id, step: step?.id ?? null, done, reason: values.reason });
                    toast(result.message);
                    await load();
                },
            });
        } catch (error) {
            errorToast(error);
        }
    });

    await load();
}
