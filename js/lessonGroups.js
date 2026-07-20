// "חלוקה פנימית של שיעורים לסקשנים/כותרות" -- purely a DISPLAY grouping
// (headers inside the always-visible lesson list), not a filter -- see
// topicsFilter.js for that separate feature. Shared by any section's own
// content-portal page (currently vault + ליווי אישי).
//
// A group carries the array of lesson ids under it -- same shape as a
// topic (see vaultStore.js's toTopic/toGroup), so the admin CRUD panel
// below mirrors topicsManagerHTML's exact pattern (a row of <select>
// pickers to assign lessons, "+ הוספת שיעור", ✕ to remove one row). Kept
// as its own small module (not a literal reuse of topicsManagerHTML)
// because both panels can be open on the same edit-mode page at once,
// and sharing one set of DOM ids between two live instances would
// collide -- these use their own distinct ids/classes throughout.

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

// --- student-facing display grouping ---------------------------------

// Returns an ordered list of { group, lessons } buckets: the ungrouped
// bucket (group: null) first if it has any lessons, then each defined
// group in its own order (skipped if it ends up empty, e.g. every lesson
// in it got hidden/deleted). Only ever reads from `lessons` itself for
// membership, so a deleted lesson id lingering in a group's array is
// naturally dropped, never rendered as a broken entry.
export function organizeLessonsByGroup(lessons, groups) {
  const groupedIds = new Set();
  (groups || []).forEach((g) => (g.linkedLessonIds || []).forEach((id) => groupedIds.add(id)));
  const buckets = [];
  const ungrouped = lessons.filter((l) => !groupedIds.has(l.id));
  if (ungrouped.length) buckets.push({ group: null, lessons: ungrouped });
  (groups || []).forEach((g) => {
    const lessonsInGroup = (g.linkedLessonIds || [])
      .map((id) => lessons.find((l) => l.id === id))
      .filter(Boolean);
    if (lessonsInGroup.length) buckets.push({ group: g, lessons: lessonsInGroup });
  });
  return buckets;
}

// Clean text heading + a thin line -- deliberately NOT a card/panel, per
// the "בלי מלבן גדול, בלי עיצוב כבד, בלי להרגיש כמו סקשן נפרד" requirement.
export function lessonGroupHeaderHTML(name) {
  return `<div class="lesson-group-header"><span class="lesson-group-title">${escapeHtml(name)}</span></div>`;
}

// --- master-only management: create/edit/delete groups + assign lessons

function groupLessonRowHTML(lessons, selectedId, canRemove) {
  const options = (lessons || [])
    .map((l) => `<option value="${escapeAttr(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`)
    .join('');
  return `
    <div class="hl-lesson-link-row">
      <select class="group-lesson-select">
        <option value="">בחר שיעור</option>
        ${options}
      </select>
      ${canRemove ? '<button type="button" class="btn-ghost small" data-remove-group-lesson title="הסרה">✕</button>' : ''}
    </div>`;
}

export function groupsManagerHTML({ groups, lessons, editing }) {
  const isEditing = !!editing;
  const linkedIds = isEditing ? editing.linkedLessonIds || [] : [];
  const rowIds = linkedIds.length ? linkedIds : [null];
  const lessonRowsHTML = rowIds.map((id, i) => groupLessonRowHTML(lessons, id, i > 0)).join('');

  const cards = (groups || [])
    .map((g) => {
      const linkedNames = (g.linkedLessonIds || [])
        .map((id) => (lessons || []).find((l) => l.id === id))
        .filter(Boolean)
        .map((l) => escapeHtml(l.title));
      const metaLabel = linkedNames.length === 0 ? 'לא משויכים שיעורים עדיין' : `שיעורים: ${linkedNames.join(', ')}`;
      return `
      <div class="hl-card" data-id="${g.id}">
        <p class="hl-card-text">${escapeHtml(g.name)}</p>
        <p class="hl-card-meta">${metaLabel}</p>
        <div class="hl-card-actions">
          <button type="button" class="btn-ghost small" data-group-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-group-action="delete">מחיקה</button>
        </div>
      </div>`;
    })
    .join('');

  return `
    <form id="lessonGroupForm" novalidate>
      <div class="field-group">
        <label for="lessonGroupName">${isEditing ? 'עריכת שם הכותרת' : 'שם כותרת/סקשן חדש'}</label>
        <input type="text" id="lessonGroupName" placeholder="לדוגמה: שיעורי בונוס" value="${isEditing ? escapeAttr(editing.name) : ''}">
      </div>
      <div class="field-group">
        <label>שיעורים בכותרת זו <span class="muted-note">(לא חובה)</span></label>
        <div id="lessonGroupLessonLinks" class="hl-lesson-links">${lessonRowsHTML}</div>
        <button type="button" class="btn-ghost small" id="lessonGroupAddLessonLink">+ הוספת שיעור</button>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-gold">${isEditing ? 'שמירת שינויים' : 'יצירת כותרת'}</button>
        ${isEditing ? '<button type="button" class="btn-ghost" id="lessonGroupCancelEdit">ביטול</button>' : ''}
      </div>
    </form>
    <div class="hl-card-list">${cards || '<p class="placeholder-desc">אין עדיין כותרות/סקשנים.</p>'}</div>`;
}

// `store` is the section store (vaultStore / personalGuidanceStore); only
// its `.groups` API is touched. `groups` is the caller's own full local
// array, patched in place after each successful store call so `rerender`
// can be a pure local repaint -- same pattern as wireTopicsManager.
export function wireGroupsManager(root, { store, lessons, groups, rerender, getEditingId, setEditingId }) {
  const form = root.querySelector('#lessonGroupForm');
  if (!form) return;

  const linksContainer = root.querySelector('#lessonGroupLessonLinks');
  const addLinkBtn = root.querySelector('#lessonGroupAddLessonLink');
  if (addLinkBtn) {
    addLinkBtn.addEventListener('click', () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = groupLessonRowHTML(lessons, null, true);
      linksContainer.appendChild(wrap.firstElementChild);
    });
  }
  if (linksContainer) {
    linksContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-group-lesson]');
      if (!btn) return;
      btn.closest('.hl-lesson-link-row').remove();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = root.querySelector('#lessonGroupName').value.trim();
    if (!name) return;
    const linkedLessonIds = Array.from(root.querySelectorAll('.group-lesson-select'))
      .map((s) => s.value)
      .filter(Boolean);
    const editingId = getEditingId();
    if (editingId) {
      const updated = await store.groups.update(editingId, { name, linkedLessonIds });
      if (updated) {
        const idx = groups.findIndex((g) => g.id === editingId);
        if (idx !== -1) groups[idx] = updated;
      }
      setEditingId(null);
    } else {
      const created = await store.groups.create({ name, linkedLessonIds });
      if (created) groups.push(created);
    }
    await rerender();
  });

  const cancel = root.querySelector('#lessonGroupCancelEdit');
  if (cancel) {
    cancel.addEventListener('click', async () => {
      setEditingId(null);
      await rerender();
    });
  }

  root.querySelectorAll('[data-group-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.hl-card').dataset.id;
      const action = btn.dataset.groupAction;
      if (action === 'edit') {
        setEditingId(id);
        await rerender();
        return;
      }
      if (action === 'delete') {
        if (!window.confirm('למחוק את הכותרת? השיוך שלה לשיעורים יוסר (השיעורים עצמם לא יימחקו).')) return;
        await store.groups.remove(id);
        const idx = groups.findIndex((g) => g.id === id);
        if (idx !== -1) groups.splice(idx, 1);
        if (getEditingId() === id) setEditingId(null);
      }
      await rerender();
    });
  });
}
