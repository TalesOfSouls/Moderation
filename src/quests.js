/**
 * Quests of a character
 *
 * quest            quest (title in quest_l11n)
 * quest_state      steps of a quest (quest_state_quest, quest_state_order, quest_state_target, title in quest_state_l11n)
 * character_quest  quest of a character (character_quest_status: 0 = active, 1 = completed, 2 = abandoned)
 * character_quest_step  progress of a step (character_quest_step_completed = time, _moderator = completed by the team)
 */
'use strict';

const { now } = require('./util');

const STATUS = { 0: 'active', 1: 'completed', 2: 'abandoned' };

function definitions (db)
{
    const quests = db.all(
        `SELECT q.quest_id AS id, q.quest_level_min AS levelMin, q.quest_level_max AS levelMax, q.quest_prerequesit AS prerequisite,
                (SELECT l.quest_l11n_title FROM quest_l11n l WHERE l.quest_l11n_quest = q.quest_id ORDER BY l.quest_l11n_lang = 'en' DESC LIMIT 1) AS title
         FROM quest q ORDER BY q.quest_id`
    );

    const steps = db.all(
        `SELECT s.quest_state_id AS id, s.quest_state_quest AS quest, s.quest_state_order AS position, COALESCE(s.quest_state_target, 1) AS target,
                (SELECT l.quest_state_l11n_title FROM quest_state_l11n l WHERE l.quest_state_l11n_state = s.quest_state_id LIMIT 1) AS title
         FROM quest_state s WHERE s.quest_state_quest IS NOT NULL ORDER BY s.quest_state_quest, s.quest_state_order`
    );

    for (const quest of quests) {
        quest.title = quest.title ?? 'Quest #' + quest.id;
        quest.steps = steps.filter((s) => s.quest === quest.id);
    }

    return quests;
}

/**
 * All quests with the progress of a character
 */
function forCharacter (db, character)
{
    const progress = db.all(
        `SELECT cq.character_quest_id AS id, cq.character_quest_quest AS quest, cq.character_quest_status AS status,
                cq.character_quest_started AS started, cq.character_quest_completed AS completed
         FROM character_quest cq WHERE cq.character_quest_character = ?`,
        character
    );

    const steps = db.all(
        `SELECT st.character_quest_step_quest AS characterQuest, st.character_quest_step_state AS state, st.character_quest_step_progress AS progress,
                st.character_quest_step_completed AS completed, st.character_quest_step_moderator AS moderator, m.account_name AS moderatorName
         FROM character_quest_step st
         JOIN character_quest cq ON cq.character_quest_id = st.character_quest_step_quest
         LEFT JOIN account m ON m.account_id = st.character_quest_step_moderator
         WHERE cq.character_quest_character = ?`,
        character
    );

    return definitions(db).map((quest) => {
        const cq = progress.find((p) => p.quest === quest.id) ?? null;

        return {
            ...quest,
            status: cq === null ? 'not started' : (STATUS[cq.status] ?? 'active'),
            started: cq?.started ?? null,
            completed: cq?.completed ?? null,
            steps: quest.steps.map((step) => {
                const s = cq === null ? undefined : steps.find((x) => x.characterQuest === cq.id && x.state === step.id);

                return { ...step, progress: s?.progress ?? 0, completed: s?.completed ?? null, moderatorName: s?.moderatorName ?? null };
            }),
        };
    });
}

function characterQuest (db, character, quest, t)
{
    let row = db.get('SELECT character_quest_id AS id, character_quest_status AS status FROM character_quest WHERE character_quest_character = ? AND character_quest_quest = ?', character, quest);
    if (row === null) {
        const id = Number(db.run(
            'INSERT INTO character_quest (character_quest_quest, character_quest_character, character_quest_status, character_quest_started) VALUES (?, ?, 0, ?)',
            quest, character, t
        ).lastInsertRowid);
        row = { id, status: 0 };
    }

    return row;
}

function setStep (db, cq, step, done, moderator, t)
{
    const existing = db.get('SELECT character_quest_step_id AS id FROM character_quest_step WHERE character_quest_step_quest = ? AND character_quest_step_state = ?', cq, step.id);
    const progress = done ? step.target : 0;

    if (existing === null) {
        db.run(
            'INSERT INTO character_quest_step (character_quest_step_quest, character_quest_step_state, character_quest_step_progress, character_quest_step_completed, character_quest_step_moderator) VALUES (?, ?, ?, ?, ?)',
            cq, step.id, progress, done ? t : null, done ? moderator : null
        );
    } else {
        db.run(
            'UPDATE character_quest_step SET character_quest_step_progress = ?, character_quest_step_completed = ?, character_quest_step_moderator = ? WHERE character_quest_step_id = ?',
            progress, done ? t : null, done ? moderator : null, existing.id
        );
    }
}

/**
 * Complete or reset a quest or one step of it
 *
 * @param {{character:number, quest:number, step?:number|null, done:boolean, moderator:number}} options
 *
 * @return {{quest:object, changed:string}}
 */
function update (db, options)
{
    const quest = definitions(db).find((q) => q.id === options.quest);
    if (quest === undefined) {
        return null;
    }

    const step = options.step ? quest.steps.find((s) => s.id === options.step) : null;
    if (options.step && step === undefined) {
        return null;
    }

    const t = now();

    db.transaction(() => {
        const cq = characterQuest(db, options.character, quest.id, t);

        if (step === null) {
            for (const s of quest.steps) {
                setStep(db, cq.id, s, options.done, options.moderator, t);
            }
        } else {
            setStep(db, cq.id, step, options.done, options.moderator, t);
            // completing a step also completes the steps before it (the game does not allow skipping)
            if (options.done) {
                for (const s of quest.steps.filter((x) => x.position < step.position)) {
                    const existing = db.get('SELECT character_quest_step_completed AS completed FROM character_quest_step WHERE character_quest_step_quest = ? AND character_quest_step_state = ?', cq.id, s.id);
                    if (existing === null || existing.completed === null) {
                        setStep(db, cq.id, s, true, options.moderator, t);
                    }
                }
            }
        }

        const open = db.value(
            'SELECT COUNT(*) FROM quest_state s LEFT JOIN character_quest_step st ON st.character_quest_step_state = s.quest_state_id AND st.character_quest_step_quest = ? WHERE s.quest_state_quest = ? AND st.character_quest_step_completed IS NULL',
            cq.id, quest.id
        );

        if (open === 0 && options.done) {
            db.run('UPDATE character_quest SET character_quest_status = 1, character_quest_completed = ? WHERE character_quest_id = ?', t, cq.id);
        } else {
            db.run('UPDATE character_quest SET character_quest_status = 0, character_quest_completed = NULL WHERE character_quest_id = ?', cq.id);
        }
    });

    return { quest, step };
}

module.exports = { definitions, forCharacter, update, STATUS };
