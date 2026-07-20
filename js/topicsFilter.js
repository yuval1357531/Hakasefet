// "מערכת סינון שיעורים" -- topic-based lesson filtering, shared logic so
// any section's own page (currently only mountVaultHome; מהישרדות לחופש
// can adopt this later with zero new code, just its own `store` and
// `topics` data) gets the same filter toggle, chips, and admin management
// panel. Mirrors insightsTicker.js's own shape exactly: pure/sync HTML
// builders + separate wire* functions, `store` passed in by the caller
// (vaultStore/freedomStore), nothing here talks to Supabase directly.
//
// A topic just carries the array of lesson ids it applies to (see
// vaultStore.js's toTopic) -- same "linked_lesson_ids on the many side"
// shape vault_highlights already uses for its own lesson links, so
// topic<->lesson assignment reuses that exact established UI pattern
// (a row of <select> pickers, "+ הוספת שיעור" to add another, ✕ to
// remove one row) instead of inventing a new multi-select widget.

import { helpTipHTML } from './helpTip.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

// --- student-facing filter: toggle + chips --------------------------

// Nothing to filter by yet (master hasn't created any topics) -- render
// nothing at all rather than an empty, useless toggle.
export function topicsFilterHTML(topics, { filterOn, selectedTopicIds }) {
  if (!topics || topics.length === 0) return '';
  const chipsHTML = filterOn
    ? topics
        .map((t) => {
          const active = selectedTopicIds.has(t.id);
          return `<button type="button" class="topic-chip ${active ? 'is-active' : ''}" data-topic-id="${escapeAttr(t.id)}">${escapeHtml(t.name)}</button>`;
        })
        .join('')
    : '';
  return `
    <div class="topics-filter">
      <span class="personal-help-row">
        <label class="topics-filter-toggle">
          <input type="checkbox" id="topicsFilterToggle" ${filterOn ? 'checked' : ''}>
          <span class="topics-filter-diamond" aria-hidden="true"></span>
          <span class="topics-filter-label-text">הפעלת סינון</span>
        </label>
        ${helpTipHTML('topics-filter', 'הכספת היא לא קורס שחייבים לעבור לפי הסדר. היא יותר כמו ספרייה, בית ספר או אוניברסיטה של תכנים להתפתחות בכמה נושאים. הסינון עוזר לך למצוא שיעורים לפי נושא ולבחור את מה שהכי מתאים לך עכשיו. תמיד אפשר להתייעץ עם יובל או בקבוצה.')}
      </span>
      ${filterOn ? `<div class="topics-chip-row">${chipsHTML}</div>` : ''}
    </div>`;
}

// `onToggle(checked)` / `onSelectTopic(topicId)` are the caller's own
// local state mutators -- this stays a pure DOM-wiring function, exactly
// like every other wire* in this codebase.
export function wireTopicsFilter(root, { onToggle, onSelectTopic }) {
  const toggle = root.querySelector('#topicsFilterToggle');
  if (toggle) {
    toggle.addEventListener('change', () => onToggle(toggle.checked));
  }
  root.querySelectorAll('.topic-chip').forEach((chip) => {
    chip.addEventListener('click', () => onSelectTopic(chip.dataset.topicId));
  });
}

// OR logic: a lesson shows if it belongs to at least one selected topic.
// No topics selected (filter on but nothing chosen yet) -- show everything,
// per the "לא להסתיר יותר מדי תוכן" requirement.
export function filterLessonsByTopics(lessons, topics, selectedTopicIds) {
  if (!selectedTopicIds || selectedTopicIds.size === 0) return lessons;
  const allowedLessonIds = new Set();
  (topics || []).forEach((t) => {
    if (selectedTopicIds.has(t.id)) (t.linkedLessonIds || []).forEach((id) => allowedLessonIds.add(id));
  });
  return lessons.filter((l) => allowedLessonIds.has(l.id));
}

// --- master-only management: create/edit/delete topics + assign lessons

function topicLessonRowHTML(lessons, selectedId, canRemove) {
  const options = (lessons || [])
    .map((l) => `<option value="${escapeAttr(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`)
    .join('');
  return `
    <div class="hl-lesson-link-row">
      <select class="topic-lesson-select">
        <option value="">בחר שיעור</option>
        ${options}
      </select>
      ${canRemove ? '<button type="button" class="btn-ghost small" data-remove-topic-lesson title="הסרה">✕</button>' : ''}
    </div>`;
}

export function topicsManagerHTML({ topics, lessons, editing }) {
  const isEditing = !!editing;
  const linkedIds = isEditing ? editing.linkedLessonIds || [] : [];
  const rowIds = linkedIds.length ? linkedIds : [null];
  const lessonRowsHTML = rowIds.map((id, i) => topicLessonRowHTML(lessons, id, i > 0)).join('');

  const cards = (topics || [])
    .map((t) => {
      const linkedNames = (t.linkedLessonIds || [])
        .map((id) => (lessons || []).find((l) => l.id === id))
        .filter(Boolean)
        .map((l) => escapeHtml(l.title));
      const metaLabel = linkedNames.length === 0 ? 'לא משויך לשיעורים עדיין' : `שיעורים: ${linkedNames.join(', ')}`;
      return `
      <div class="hl-card" data-id="${t.id}">
        <p class="hl-card-text">${escapeHtml(t.name)}</p>
        <p class="hl-card-meta">${metaLabel}</p>
        <div class="hl-card-actions">
          <button type="button" class="btn-ghost small" data-topic-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-topic-action="delete">מחיקה</button>
        </div>
      </div>`;
    })
    .join('');

  return `
    <form id="topicForm" novalidate>
      <div class="field-group">
        <label for="topicName">${isEditing ? 'עריכת שם הנושא' : 'שם נושא חדש'}</label>
        <input type="text" id="topicName" placeholder="לדוגמה: זכריות" value="${isEditing ? escapeAttr(editing.name) : ''}">
      </div>
      <div class="field-group">
        <label>שיעורים בנושא זה <span class="muted-note">(לא חובה)</span></label>
        <div id="topicLessonLinks" class="hl-lesson-links">${lessonRowsHTML}</div>
        <button type="button" class="btn-ghost small" id="topicAddLessonLink">+ הוספת שיעור</button>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-gold">${isEditing ? 'שמירת שינויים' : 'יצירת נושא'}</button>
        ${isEditing ? '<button type="button" class="btn-ghost" id="topicCancelEdit">ביטול</button>' : ''}
      </div>
    </form>
    <div class="hl-card-list">${cards || '<p class="placeholder-desc">אין עדיין נושאים.</p>'}</div>`;
}

// `store` is the section store (vaultStore / freedomStore); only its
// `.topics` API is touched. `topics` is the caller's own full local
// array, patched in place after each successful store call so `rerender`
// can be a pure local repaint -- same pattern as wireHighlightsManager.
export function wireTopicsManager(root, { store, lessons, topics, rerender, getEditingId, setEditingId }) {
  const form = root.querySelector('#topicForm');
  if (!form) return;

  const linksContainer = root.querySelector('#topicLessonLinks');
  const addLinkBtn = root.querySelector('#topicAddLessonLink');
  if (addLinkBtn) {
    addLinkBtn.addEventListener('click', () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = topicLessonRowHTML(lessons, null, true);
      linksContainer.appendChild(wrap.firstElementChild);
    });
  }
  if (linksContainer) {
    linksContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-topic-lesson]');
      if (!btn) return;
      btn.closest('.hl-lesson-link-row').remove();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = root.querySelector('#topicName').value.trim();
    if (!name) return;
    const linkedLessonIds = Array.from(root.querySelectorAll('.topic-lesson-select'))
      .map((s) => s.value)
      .filter(Boolean);
    const editingId = getEditingId();
    if (editingId) {
      const updated = await store.topics.update(editingId, { name, linkedLessonIds });
      if (updated) {
        const idx = topics.findIndex((t) => t.id === editingId);
        if (idx !== -1) topics[idx] = updated;
      }
      setEditingId(null);
    } else {
      const created = await store.topics.create({ name, linkedLessonIds });
      if (created) topics.push(created);
    }
    await rerender();
  });

  const cancel = root.querySelector('#topicCancelEdit');
  if (cancel) {
    cancel.addEventListener('click', async () => {
      setEditingId(null);
      await rerender();
    });
  }

  root.querySelectorAll('[data-topic-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.hl-card').dataset.id;
      const action = btn.dataset.topicAction;
      if (action === 'edit') {
        setEditingId(id);
        await rerender();
        return;
      }
      if (action === 'delete') {
        if (!window.confirm('למחוק את הנושא? השיוך שלו לשיעורים יוסר.')) return;
        await store.topics.remove(id);
        const idx = topics.findIndex((t) => t.id === id);
        if (idx !== -1) topics.splice(idx, 1);
        if (getEditingId() === id) setEditingId(null);
      }
      await rerender();
    });
  });
}
