// User-facing pages for the "ליווי אישי" section -- the SAME content-
// portal engine as vaultSection.js (הכספת), byte-for-byte, pointed at its
// own personalGuidanceStore/personalGuidanceCommentsStore tables. Per the
// "לשכפל/להרחיב את המנוע הקיים, לא לבנות מנוע חדש" requirement, this file
// is a deliberate mirror of vaultSection.js -- any future engine fix
// belongs in BOTH files, the same way vaultSection.js/freedomSection.js
// already have to be kept in sync today.
//
// One addition vaultSection.js doesn't need: access here is permission-
// gated (permission_personal_guidance), but the section still always
// shows in the sidebar (see dashboard.js) -- a user without access sees a
// clean "locked" placeholder instead of the real content when they open
// it, rather than being hard-denied at the router level.

import { personalGuidanceStore } from '../data/personalGuidanceStore.js';
import { personalGuidanceCommentsStore as commentsStore } from '../data/personalGuidanceCommentsStore.js';
import { progressStore } from '../data/progressStore.js';
import { contentStore } from '../data/contentStore.js';
import { journalStore } from '../data/journalStore.js';
import { auth } from '../auth.js';
import { editableField, wireEditableFields, reorderButtonsHTML, wireReorderButtons } from '../inlineEdit.js';
import {
  buildTickerItems,
  tickerHTML,
  wireTicker,
  highlightsManagerHTML,
  wireHighlightsManager,
  trailNotesForLesson,
  trailNotesHTML,
  trailManagerHTML,
  wireTrailManager,
  wireTrailNotesJournalSave,
  wireTrailExpand,
} from '../insightsTicker.js';
import {
  topicsFilterHTML,
  wireTopicsFilter,
  filterLessonsByTopics,
  topicsManagerHTML,
  wireTopicsManager,
} from '../topicsFilter.js';
import {
  organizeLessonsByGroup,
  lessonGroupHeaderHTML,
  groupsManagerHTML,
  wireGroupsManager,
} from '../lessonGroups.js';
import { accordionHTML, wireAccordions } from '../adminAccordion.js';
import { backButtonHTML, wirePageBackButton } from '../pageBackButton.js';

const STATUS_LABELS = { pending: 'ממתין', approved: 'מאושר', hidden: 'מוסתר' };
const STATUS_BADGE = { pending: '', approved: 'badge-active', hidden: 'badge-blocked' };

// "מסך בלי גישה" -- shown to a real visitor without permission_personal_
// guidance (never any real lesson/video/trail/comment data, see the
// guards at the top of mountPersonalGuidanceHome/mountPersonalGuidanceLesson),
// and to the master in edit mode via the "תצוגת בלי גישה" toggle below
// (editable there). Content lives on the SAME sections row as the
// section's own title/description, just under its own locked_* columns --
// deliberately separate fields, since this message is for a completely
// different audience than the real unlocked content.
function lockedHTML(sectionRecord, section, editable) {
  const lockedTitle = (sectionRecord && sectionRecord.lockedTitle) || 'ליווי אישי';
  const lockedDescription =
    (sectionRecord && sectionRecord.lockedDescription) ||
    'התוכן הזה נעול כרגע. לפתיחת גישה לליווי אישי יש לפנות ליובל.';
  const lockedCta =
    (sectionRecord && sectionRecord.lockedCta) ||
    'אם אתה מרגיש שהגיע הזמן לליווי אישי, אפשר לפנות ליובל כדי לבדוק התאמה ופתיחת גישה.';
  const lockedMediaUrl = (sectionRecord && sectionRecord.lockedMediaUrl) || '';
  const titleHTML = editable ? editableField(section.id, 'lockedTitle', lockedTitle) : escapeHtml(lockedTitle);
  const descHTML = editable
    ? editableField(section.id, 'lockedDescription', lockedDescription, { multiline: true })
    : escapeHtml(lockedDescription);
  const ctaHTML = editable
    ? editableField(section.id, 'lockedCta', lockedCta, { multiline: true })
    : escapeHtml(lockedCta);
  const mediaHTML = editable
    ? `<p class="lesson-embed-edit">קישור למדיה (תמונה / קובץ / PDF / סילבוס): ${editableField(section.id, 'lockedMediaUrl', lockedMediaUrl || '(לא הוגדר)')}</p>`
    : lockedMediaUrl
      ? `<a class="btn-ghost small" href="${escapeAttr(lockedMediaUrl)}" target="_blank" rel="noopener">צפייה בחומר מצורף</a>`
      : '';
  return `
    <div class="admin-page">
      <div class="admin-page-header">
        <h1 class="gold-title placeholder-title">${titleHTML}</h1>
        <p class="placeholder-desc">${descHTML}</p>
      </div>
      <div class="placeholder-badge">🔒 אין לך גישה לאזור זה כרגע</div>
      <p class="lesson-text" style="margin-top: 18px;">${ctaHTML}</p>
      ${mediaHTML}
    </div>`;
}

// Master-only, edit mode only -- lets the master preview the "no access"
// screen without touching their own real permissions. Reuses the exact
// look of the lesson-detail "תצוגת תיאור" mode row.
function viewModeToggleHTML(viewAsLocked) {
  return `
    <div class="desc-mode-row">
      <span class="desc-mode-label">תצוגה:</span>
      <button type="button" class="btn-ghost small ${!viewAsLocked ? 'is-active-mode' : ''}" data-view-mode="access">תצוגת בעלי גישה</button>
      <button type="button" class="btn-ghost small ${viewAsLocked ? 'is-active-mode' : ''}" data-view-mode="locked">תצוגת בלי גישה</button>
    </div>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

function firstName(name) {
  return (name || 'משתמש').trim().split(/\s+/)[0];
}

function embedHTML(embedUrl) {
  if (!embedUrl) {
    return `
      <div class="video-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>
        <span>לא הוגדר עדיין קישור וידאו לשיעור זה</span>
      </div>`;
  }
  return `
    <div class="embed-frame">
      <iframe src="${escapeAttr(embedUrl)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    </div>`;
}

export async function mountPersonalGuidanceHome(container, section, session) {
  const editMode = auth.isEditMode();
  if (!editMode && !auth.hasAccess('personalGuidance')) {
    // Real (non-admin) visitor without access: only the lightweight
    // section row is fetched (for the editable locked-screen text) --
    // never lessons/highlights/comments/topics/groups.
    const sectionRecordOnly = await contentStore.sections.getById(section.id);
    container.innerHTML = lockedHTML(sectionRecordOnly, section, false);
    return;
  }

  // Master-only, edit mode only: lets the master preview the "no access"
  // screen (and edit its text/media) without changing their own real
  // permissions -- a real visitor without access always gets the locked
  // screen above regardless of this, since it's never even reached for
  // them.
  let viewAsLocked = false;

  // Which ticker phrase (if any) the master is currently editing -- kept
  // across re-renders so the edit form stays populated.
  let editingHighlightId = null;
  // Which lesson's title is currently being renamed inline (a fixed
  // pencil button in the row's action strip, not tied to the title's own
  // width -- see the lesson-row-title-form branch in the tabs map below).
  let editingLessonTitleId = null;
  // Which collapsible management panels are open -- kept across
  // re-renders so the panel the master is actively working in doesn't
  // snap shut on them.
  const openAccordions = new Set();
  // Which topic (if any) the master is currently editing in "ניהול סינון
  // שיעורים".
  let editingTopicId = null;
  // Lesson-topic filter -- student-facing, local UI state only (never
  // persisted): off by default (everyone sees every lesson), and clearing
  // the toggle always clears any chosen topics too so re-enabling it
  // later starts from "show everything" again.
  let topicsFilterOn = false;
  const selectedTopicIds = new Set();
  // Which lesson-group (if any) the master is currently editing in "ניהול
  // סקשני שיעורים".
  let editingGroupId = null;

  // Local state -- fetched once by loadData(), then patched in place by
  // each action. paint() only ever reads from these, never the network.
  let sectionRecord = null;
  let lessons = [];
  let userProgress = [];
  let highlights = [];
  let approvedComments = [];
  let topics = [];
  let groups = [];

  async function loadData() {
    const editMode = auth.isEditMode();
    const [sr, ls, up, ac, hl, tp, gr] = await Promise.all([
      contentStore.sections.getById(section.id),
      editMode ? personalGuidanceStore.lessons.getAll() : personalGuidanceStore.lessons.getActive(),
      progressStore.getForUser(session.id),
      commentsStore.getApprovedAll(),
      editMode ? personalGuidanceStore.highlights.getAll() : personalGuidanceStore.highlights.getActive(),
      personalGuidanceStore.topics.getAll(),
      personalGuidanceStore.groups.getAll(),
    ]);
    topics = tp;
    groups = gr;
    sectionRecord = sr;
    lessons = ls;
    userProgress = up;
    approvedComments = ac;
    highlights = hl;
  }

  function wireViewToggle() {
    container.querySelectorAll('[data-view-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        viewAsLocked = btn.dataset.viewMode === 'locked';
        paint();
      });
    });
  }

  function paint() {
    const editMode = auth.isEditMode();
    // Master preview toggle: show the (editable) locked screen instead of
    // the real content, without touching any real permission.
    if (editMode && viewAsLocked) {
      container.innerHTML = viewModeToggleHTML(viewAsLocked) + lockedHTML(sectionRecord, section, true);
      wireEditableFields(container, {
        onSave: async (id, field, value) => {
          const updated = await contentStore.sections.update(id, { [field]: value });
          if (updated) sectionRecord = updated;
        },
        rerender: paint,
      });
      wireViewToggle();
      return;
    }
    const label = (sectionRecord && sectionRecord.title) || section.label;
    const description = (sectionRecord && sectionRecord.description) || section.description;
    const completedIds = new Set(userProgress.filter((p) => p.isCompleted).map((p) => p.lessonId));
    // Topic filtering is a student-facing affordance only -- edit mode
    // always manages every lesson regardless of filter state.
    const visibleLessons = editMode ? lessons : filterLessonsByTopics(lessons, topics, selectedTopicIds);

    function lessonTabHTML(lesson) {
      const done = completedIds.has(lesson.id);
      const titleHTML = escapeHtml(lesson.title);
      return `
        <a class="lesson-tab ${done ? 'is-done' : ''}" href="#/${section.id}/lesson/${lesson.id}">
          <span class="lesson-tab-check">${done ? '✓' : ''}</span>
          <span class="lesson-tab-title">${titleHTML}</span>
        </a>`;
    }

    function lessonRowManageHTML(lesson) {
      // One clean row per lesson instead of a pill + a block of buttons
      // underneath it -- reorder on the row's leading (right, RTL) side,
      // title (ellipsis-truncated if long) in the middle, and a fixed
      // action strip on the trailing (left) side: a pencil that ALWAYS
      // stays visible regardless of title length (it lives in the action
      // strip, not glued to the text), hide/show, and a small round
      // delete icon. Every action here (edit/delete/hide/reorder) patches
      // local state and repaints -- no page reload.
      if (editingLessonTitleId === lesson.id) {
        return `
          <div class="lesson-row-manage ${!lesson.isActive ? 'lesson-row-inactive' : ''}">
            <div class="lesson-row-reorder">${reorderButtonsHTML(lesson.id)}</div>
            <form class="lesson-row-title-form" data-lesson-id="${lesson.id}">
              <input type="text" class="editable-input" value="${escapeAttr(lesson.title)}">
              <button type="submit" class="edit-save" title="שמירה">✓</button>
              <button type="button" class="edit-cancel" data-cancel-title-edit data-lesson-id="${lesson.id}" title="ביטול">✕</button>
            </form>
          </div>`;
      }

      const titleHTML = escapeHtml(lesson.title);
      return `
        <div class="lesson-row-manage ${!lesson.isActive ? 'lesson-row-inactive' : ''}">
          <div class="lesson-row-reorder">${reorderButtonsHTML(lesson.id)}</div>
          <a class="lesson-row-title" href="#/${section.id}/lesson/${lesson.id}">
            <span class="lesson-tab-title">${titleHTML}</span>
          </a>
          <button type="button" class="lesson-row-edit" data-lesson-action="edit-title" data-lesson-id="${lesson.id}" title="עריכת שם">✎</button>
          <button type="button" class="lesson-row-toggle ${!lesson.isActive ? 'is-hidden' : ''}" data-lesson-action="toggle-active" data-lesson-id="${lesson.id}" title="${lesson.isActive ? 'הסתרה' : 'הפעלה'}">${lesson.isActive ? '👁' : '🚫'}</button>
          <button type="button" class="lesson-row-delete" data-lesson-action="delete" data-lesson-id="${lesson.id}" title="מחיקה">🗑</button>
        </div>`;
    }

    const tabs = visibleLessons.map((lesson) => (editMode ? lessonRowManageHTML(lesson) : lessonTabHTML(lesson))).join('');

    // Student view only: lessons grouped under their own quiet text
    // headers (חלוקה פנימית) -- ungrouped lessons render exactly like
    // before (no header, one shared pill row); edit mode keeps the flat
    // management list untouched, per the "לא ליצור ממשק מסורבל" scope --
    // group ASSIGNMENT happens in its own small accordion below, not by
    // reorganizing this list.
    const groupedLessonListHTML = !editMode
      ? organizeLessonsByGroup(visibleLessons, groups)
          .map(({ group, lessons: bucketLessons }) => {
            const header = group ? lessonGroupHeaderHTML(group.name) : '';
            return `${header}<div class="lesson-tabs-scroll"><div class="lesson-tabs">${bucketLessons.map(lessonTabHTML).join('')}</div></div>`;
          })
          .join('')
      : '';

    const empty =
      lessons.length === 0
        ? '<div class="placeholder-badge">התוכן יתווסף בהמשך</div>'
        : !editMode && visibleLessons.length === 0
          ? '<div class="placeholder-badge">אין שיעורים בנושאים שנבחרו</div>'
          : '';
    const tickerMarkup = tickerHTML(buildTickerItems({ highlights, comments: approvedComments, completedIds, editMode }));
    const editingHighlight = editingHighlightId ? highlights.find((h) => h.id === editingHighlightId) : null;
    const titleHTML = editMode ? editableField(section.id, 'title', label) : escapeHtml(label);
    const descHTML = editMode
      ? editableField(section.id, 'description', description, { multiline: true })
      : escapeHtml(description);

    // "מערכת סינון שיעורים" -- student-facing only, sits right below the
    // top ticker and above the lesson list (see the template below).
    const topicsFilterMarkup = !editMode
      ? topicsFilterHTML(topics, { filterOn: topicsFilterOn, selectedTopicIds })
      : '';
    // Master-only topic management -- create/edit/delete topics and
    // assign lessons to them. Lives beside the other "above the lesson
    // list" management panels, closed by default like the rest.
    const editingTopic = editingTopicId ? topics.find((t) => t.id === editingTopicId) : null;
    const topicsManagerBlockHTML = editMode
      ? accordionHTML(
          'topics-manage',
          'ניהול סינון שיעורים',
          topicsManagerHTML({ topics, lessons, editing: editingTopic }),
          { isOpen: openAccordions.has('topics-manage') }
        )
      : '';
    // "חלוקה פנימית של שיעורים לסקשנים/כותרות" -- master-only, separate
    // from the topics/filter manager above (different purpose: fixed
    // display grouping, not a togglable filter).
    const editingGroup = editingGroupId ? groups.find((g) => g.id === editingGroupId) : null;
    const groupsManagerBlockHTML = editMode
      ? accordionHTML(
          'lesson-groups-manage',
          'ניהול סקשני שיעורים',
          groupsManagerHTML({ groups, lessons, editing: editingGroup }),
          { isOpen: openAccordions.has('lesson-groups-manage') }
        )
      : '';

    // "ניהול משפטים בצג העליון" -- phrases that run in the general course
    // ticker. Its lesson-link picker is only for *when* a phrase unlocks
    // there after a student completes a lesson; it is a completely
    // separate editor from "צידה לדרך" (see mountPersonalGuidanceLesson),
    // which is reached only from inside a specific lesson's own page.
    // Lives at the top of the page (above the lesson list), edit mode only.
    const highlightsHTML = editMode
      ? accordionHTML(
          'ticker-highlights',
          'ניהול משפטים בצג העליון',
          highlightsManagerHTML({ highlights, lessons, editing: editingHighlight }),
          { isOpen: openAccordions.has('ticker-highlights') }
        )
      : '';

    // "הוספת שיעור חדש" -- rendered as one more row at the END of the
    // lesson list, sized like a normal lesson row when collapsed; opens
    // in place (no reload) via the same accordion mechanism as every
    // other management panel.
    const addLessonRowHTML = editMode
      ? accordionHTML(
          'add-lesson',
          'הוספת שיעור חדש',
          `
        <form id="addLessonForm" novalidate>
          <div class="field-group">
            <label for="newLessonTitle">כותרת השיעור</label>
            <input type="text" id="newLessonTitle" placeholder="שם השיעור החדש">
          </div>
          <div class="form-actions"><button type="submit" class="btn-gold">הוספת שיעור</button></div>
        </form>`,
          { isOpen: openAccordions.has('add-lesson'), extraCardClass: 'lesson-row-add' }
        )
      : '';

    container.innerHTML = `
      <div class="admin-page">
        ${editMode ? viewModeToggleHTML(viewAsLocked) : ''}
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">${titleHTML}</h1>
          <p class="placeholder-desc">${descHTML}</p>
        </div>
        ${tickerMarkup}
        ${highlightsHTML}
        ${topicsManagerBlockHTML}
        ${groupsManagerBlockHTML}
        ${topicsFilterMarkup}
        ${empty}
        ${
          editMode
            ? `<div class="lesson-tabs is-editing">${tabs}${addLessonRowHTML}</div>`
            : groupedLessonListHTML
        }
      </div>`;

    wireTicker(container);
    wireAccordions(container, { state: openAccordions, rerender: paint });
    wireViewToggle();

    wireEditableFields(container, {
      onSave: async (id, field, value) => {
        const updated = await contentStore.sections.update(id, { [field]: value });
        if (updated) sectionRecord = updated;
      },
      rerender: paint,
    });
    wireReorderButtons(container, {
      onMove: async (id, dir) => {
        if (dir === 'up') await personalGuidanceStore.lessons.moveUp(id);
        else await personalGuidanceStore.lessons.moveDown(id);
        const idx = lessons.findIndex((l) => l.id === id);
        const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
        if (idx !== -1 && swapIdx >= 0 && swapIdx < lessons.length) {
          [lessons[idx], lessons[swapIdx]] = [lessons[swapIdx], lessons[idx]];
        }
      },
      rerender: paint,
    });
    wireHighlightsManager(container, {
      store: personalGuidanceStore,
      lessons,
      highlights,
      rerender: paint,
      getEditingId: () => editingHighlightId,
      setEditingId: (v) => { editingHighlightId = v; },
    });
    wireTopicsFilter(container, {
      onToggle: (checked) => {
        topicsFilterOn = checked;
        if (!checked) selectedTopicIds.clear();
        paint();
      },
      onSelectTopic: (topicId) => {
        if (selectedTopicIds.has(topicId)) selectedTopicIds.delete(topicId);
        else selectedTopicIds.add(topicId);
        paint();
      },
    });
    wireTopicsManager(container, {
      store: personalGuidanceStore,
      lessons,
      topics,
      rerender: paint,
      getEditingId: () => editingTopicId,
      setEditingId: (v) => { editingTopicId = v; },
    });
    wireGroupsManager(container, {
      store: personalGuidanceStore,
      lessons,
      groups,
      rerender: paint,
      getEditingId: () => editingGroupId,
      setEditingId: (v) => { editingGroupId = v; },
    });

    const addForm = container.querySelector('#addLessonForm');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = container.querySelector('#newLessonTitle');
        const title = input.value.trim();
        if (!title) return;
        const created = await personalGuidanceStore.lessons.create({ title });
        if (created) lessons.push(created);
        paint();
      });
    }

    container.querySelectorAll('[data-lesson-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.lessonId;
        const action = btn.dataset.lessonAction;
        if (action === 'edit-title') {
          editingLessonTitleId = id;
          paint();
        } else if (action === 'toggle-active') {
          const current = lessons.find((l) => l.id === id);
          if (!current) return;
          const updated = await personalGuidanceStore.lessons.update(id, { isActive: !current.isActive });
          if (updated) {
            const idx = lessons.findIndex((l) => l.id === id);
            if (idx !== -1) lessons[idx] = updated;
          }
          paint();
        } else if (action === 'delete') {
          if (window.confirm('למחוק את השיעור? כל התגובות המשויכות אליו יימחקו גם הן.')) {
            await personalGuidanceStore.lessons.remove(id);
            await commentsStore.removeByLessonId(id);
            lessons = lessons.filter((l) => l.id !== id);
            paint();
          }
        }
      });
    });

    container.querySelectorAll('.lesson-row-title-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = form.dataset.lessonId;
        const value = form.querySelector('.editable-input').value.trim();
        if (value) {
          const updated = await personalGuidanceStore.lessons.update(id, { title: value });
          if (updated) {
            const idx = lessons.findIndex((l) => l.id === id);
            if (idx !== -1) lessons[idx] = updated;
          }
        }
        editingLessonTitleId = null;
        paint();
      });
    });
    container.querySelectorAll('[data-cancel-title-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingLessonTitleId = null;
        paint();
      });
    });
  }

  await loadData();
  paint();
}

export async function mountPersonalGuidanceLesson(container, section, lesson, session) {
  if (!auth.isEditMode() && !auth.hasAccess('personalGuidance')) {
    // Defensive only -- router.js already redirects a locked visitor's
    // direct lesson URL back to the home (locked) screen before this ever
    // mounts; kept here too in case this is ever reached another way, and
    // never fetches any lesson/comment/trail data either way.
    const sectionRecordOnly = await contentStore.sections.getById(section.id);
    container.innerHTML = lockedHTML(sectionRecordOnly, section, false);
    return;
  }

  // Which collapsible management panels are open -- kept across re-renders.
  const openAccordions = new Set();
  // Which "צידה לדרך" phrase (if any) the master is currently editing.
  let editingTrailId = null;
  // Whether the video-link form is currently open -- local UI state only,
  // never touches the network by itself.
  let editingEmbed = false;

  // Local state -- fetched once by loadData(), then patched in place.
  let record = null;
  let comments = [];
  let freshLesson = lesson;
  let highlights = [];
  let journalSavedKeys = new Set();

  async function loadData() {
    const editMode = auth.isEditMode();
    const [r, c, freshLessonRaw, hl, savedKeys] = await Promise.all([
      progressStore.getForLesson(session.id, lesson.id),
      commentsStore.getByLessonId(lesson.id),
      personalGuidanceStore.lessons.getById(lesson.id),
      editMode ? personalGuidanceStore.highlights.getAll() : personalGuidanceStore.highlights.getActive(),
      journalStore.getSavedKeys(session.id),
    ]);
    record = r;
    comments = c;
    freshLesson = freshLessonRaw || lesson;
    highlights = hl;
    journalSavedKeys = savedKeys;
  }

  function paint() {
    const editMode = auth.isEditMode();
    const isCompleted = !!(record && record.isCompleted);
    // "צידה לדרך" -- notes/phrases scoped to THIS lesson only. Same
    // underlying rows as the general ticker manager
    // (mountPersonalGuidanceHome), just filtered to this lesson id;
    // editing here never touches any other lesson's links (see
    // wireTrailManager in insightsTicker.js).
    const trailItems = trailNotesForLesson(highlights, freshLesson.id);
    const approvedComments = comments.filter((c) => c.status === 'approved');

    const commentsHTML = approvedComments.length
      ? approvedComments
          .map(
            (c) => `
        <div class="comment-item">
          <span class="comment-author">${escapeHtml(c.displayName)}</span>
          <p class="comment-text">${escapeHtml(c.text)}</p>
        </div>`
          )
          .join('')
      : '<p class="placeholder-desc">אין עדיין תגובות מאושרות לשיעור זה.</p>';

    const titleHTML = editMode ? editableField(freshLesson.id, 'title', freshLesson.title) : escapeHtml(freshLesson.title);
    const descriptionMode = freshLesson.descriptionMode === 'popup' ? 'popup' : 'inline';
    const showInlineDesc = editMode || descriptionMode === 'inline';
    const descHTML = editMode
      ? editableField(freshLesson.id, 'description', freshLesson.description, { multiline: true })
      : escapeHtml(freshLesson.description);
    // Clear, dedicated video-link control (Spotlightr / any embed URL) --
    // a visible button rather than a hidden pencil, toggled locally with
    // no reload.
    const embedManageHTML = editMode
      ? editingEmbed
        ? `
        <div class="lesson-embed-manage">
          <form id="embedForm" novalidate>
            <div class="field-group">
              <label for="embedUrlInput">קישור וידאו (Spotlightr / embed link)</label>
              <input type="text" id="embedUrlInput" placeholder="הדבק כאן קישור embed" value="${escapeAttr(freshLesson.embedUrl || '')}">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-gold">שמירת קישור</button>
              <button type="button" class="btn-ghost small" id="embedCancelBtn">ביטול</button>
            </div>
          </form>
        </div>`
        : `
        <div class="lesson-embed-manage">
          <button type="button" class="btn-ghost small" id="embedEditToggle">${freshLesson.embedUrl ? 'ערוך קישור וידאו' : 'הוסף קישור וידאו'}</button>
        </div>`
      : '';
    const hintHTML = editMode
      ? `<p class="lesson-embed-edit">משפט/הנחיה קצרה: ${editableField(freshLesson.id, 'hintText', freshLesson.hintText || '(לא הוגדר)')}</p>`
      : freshLesson.hintText
        ? `<p class="lesson-hint">${escapeHtml(freshLesson.hintText)}</p>`
        : '';
    const descModeRowHTML = editMode
      ? `
      <div class="desc-mode-row">
        <span class="desc-mode-label">תצוגת תיאור:</span>
        <button type="button" class="btn-ghost small ${descriptionMode === 'inline' ? 'is-active-mode' : ''}" data-desc-mode="inline">קבוע מתחת לשיעור</button>
        <button type="button" class="btn-ghost small ${descriptionMode === 'popup' ? 'is-active-mode' : ''}" data-desc-mode="popup">קופץ לפני הצפייה</button>
      </div>`
      : '';

    const seenKey = `personalguidance_desc_seen_${freshLesson.id}`;
    const showPopup =
      !editMode && descriptionMode === 'popup' && freshLesson.description && !sessionStorage.getItem(seenKey);
    const popupHTML = showPopup
      ? `
      <div class="desc-modal-overlay" id="descModalOverlay">
        <div class="desc-modal-card panel-card">
          <p class="lesson-text">${escapeHtml(freshLesson.description)}</p>
          <button type="button" class="btn-gold" id="descModalClose">המשך לצפייה</button>
        </div>
      </div>`
      : '';

    const commentModerationHTML = editMode
      ? accordionHTML('comment-moderation', 'ניהול תגובות לשיעור', moderationHTML(comments), {
          isOpen: openAccordions.has('comment-moderation'),
          badgeCount: comments.filter((c) => c.status === 'pending').length,
        })
      : '';

    const trailNotesBlockHTML = trailNotesHTML(trailItems, { lessonId: freshLesson.id, savedKeys: journalSavedKeys });
    const trailManagerBlockHTML = editMode
      ? accordionHTML(
          'trail-notes-manage',
          'ניהול צידה לדרך',
          trailManagerHTML(trailItems, editingTrailId ? trailItems.find((t) => t.id === editingTrailId) : null),
          { isOpen: openAccordions.has('trail-notes-manage') }
        )
      : '';

    container.innerHTML = `
      ${backButtonHTML()}
      <div class="admin-page">
        ${trailNotesBlockHTML}
        ${trailManagerBlockHTML}
        <div class="panel-card lesson-panel">
          <div class="lesson-page-title">
            <h1 class="gold-title lesson-title-heading">${titleHTML}</h1>
          </div>
          ${embedHTML(freshLesson.embedUrl)}
          ${embedManageHTML}
          ${hintHTML}
          ${descModeRowHTML}
          ${showInlineDesc ? `<p class="lesson-text">${descHTML}</p>` : ''}
          <button type="button" class="watch-btn ${isCompleted ? 'completed' : ''}" id="watchedBtn">
            ${isCompleted ? 'צפית בשיעור ✓ (לחיצה לביטול)' : 'צפיתי בשיעור'}
          </button>
        </div>

        <div class="panel-card comments-panel">
          <h2 class="form-title">תגובות</h2>
          <div class="comment-list">${commentsHTML}</div>
          <form id="commentForm" class="comment-form-compact" novalidate>
            <textarea id="commentText" rows="2" placeholder="כתבו תגובה..."></textarea>
            <div class="error-msg" id="commentError" role="alert"></div>
            <div class="comment-status" id="commentStatus"></div>
            <button type="submit" class="btn-gold small">שלח הערה</button>
          </form>
        </div>

        ${commentModerationHTML}
      </div>
      ${popupHTML}`;

    // Student-facing action -- reloads via the page's own async render()
    // path deliberately (out of scope for the master-actions-stay-local
    // requirement; this already worked correctly and isn't touched).
    container.querySelector('#watchedBtn').addEventListener('click', async () => {
      await progressStore.toggleCompleted(session.id, lesson.id);
      record = await progressStore.getForLesson(session.id, lesson.id);
      paint();
    });

    const overlay = container.querySelector('#descModalOverlay');
    if (overlay) {
      container.querySelector('#descModalClose').addEventListener('click', () => {
        sessionStorage.setItem(seenKey, '1');
        overlay.remove();
      });
    }

    container.querySelectorAll('[data-desc-mode]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const updated = await personalGuidanceStore.lessons.update(freshLesson.id, { descriptionMode: btn.dataset.descMode });
        if (updated) freshLesson = updated;
        paint();
      });
    });

    const embedToggleBtn = container.querySelector('#embedEditToggle');
    if (embedToggleBtn) {
      embedToggleBtn.addEventListener('click', () => {
        editingEmbed = true;
        paint();
      });
    }
    const embedCancelBtn = container.querySelector('#embedCancelBtn');
    if (embedCancelBtn) {
      embedCancelBtn.addEventListener('click', () => {
        editingEmbed = false;
        paint();
      });
    }
    const embedForm = container.querySelector('#embedForm');
    if (embedForm) {
      embedForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const value = container.querySelector('#embedUrlInput').value.trim();
        const updated = await personalGuidanceStore.lessons.update(freshLesson.id, { embedUrl: value });
        if (updated) freshLesson = updated;
        editingEmbed = false;
        paint();
      });
    }

    const form = container.querySelector('#commentForm');
    const errorEl = container.querySelector('#commentError');
    const statusEl = container.querySelector('#commentStatus');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const textarea = container.querySelector('#commentText');
      const text = textarea.value.trim();

      errorEl.textContent = '';
      errorEl.classList.remove('show');

      if (!text) {
        errorEl.textContent = 'יש לכתוב הערה לפני השליחה.';
        errorEl.classList.add('show');
        return;
      }

      const created = await commentsStore.create({
        lessonId: lesson.id,
        userId: session.id,
        displayName: firstName(session.fullName || session.username),
        text,
      });
      if (created) comments.push(created);

      textarea.value = '';
      statusEl.textContent = 'ההערה נשלחה וממתינה לאישור';
    });

    wireEditableFields(container, {
      onSave: async (id, field, value) => {
        const updated = await personalGuidanceStore.lessons.update(id, { [field]: value });
        if (updated) freshLesson = updated;
      },
      rerender: paint,
    });
    wireModeration(container, { comments, rerender: paint });
    wireTrailManager(container, {
      store: personalGuidanceStore,
      lessonId: freshLesson.id,
      highlights,
      rerender: paint,
      getEditingId: () => editingTrailId,
      setEditingId: (v) => { editingTrailId = v; },
    });
    wireAccordions(container, { state: openAccordions, rerender: paint });
    wireTrailNotesJournalSave(container, { journalStore, session, sectionId: 'personalGuidance', lessonId: freshLesson.id });
    wireTrailExpand(container);
    wirePageBackButton(container);
  }

  progressStore.recordVisit(session.id, lesson.id);
  await loadData();
  paint();
}

// Pure/sync -- `comments` is the caller's already-fetched full list (every
// status, master-only).
function moderationHTML(comments) {
  const rows = comments
    .map(
      (c) => `
      <tr data-id="${c.id}">
        <td>${escapeHtml(c.displayName)}</td>
        <td>${escapeHtml(c.text)}</td>
        <td><span class="badge ${STATUS_BADGE[c.status]}">${STATUS_LABELS[c.status]}</span></td>
        <td class="actions-cell">
          ${c.status !== 'approved' ? '<button type="button" class="btn-ghost small" data-comment-action="approve">אישור</button>' : ''}
          ${c.status !== 'hidden' ? '<button type="button" class="btn-ghost small" data-comment-action="hide">הסתרה</button>' : ''}
          <button type="button" class="btn-ghost small danger" data-comment-action="delete">מחיקה</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <div class="table-scroll">
      <table class="users-table">
        <thead><tr><th>משתמש</th><th>הערה</th><th>סטטוס</th><th>פעולות</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">אין עדיין הערות לשיעור זה.</td></tr>'}</tbody>
      </table>
    </div>`;
}

// `comments` is the caller's own local array, patched in place -- see the
// note on wireHighlightsManager in insightsTicker.js for why.
function wireModeration(container, { comments, rerender }) {
  function patch(id, updated) {
    if (!updated) return;
    const idx = comments.findIndex((c) => c.id === id);
    if (idx !== -1) comments[idx] = updated;
  }

  container.querySelectorAll('[data-comment-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const action = btn.dataset.commentAction;
      if (action === 'approve') patch(id, await commentsStore.approve(id));
      else if (action === 'hide') patch(id, await commentsStore.hide(id));
      else if (action === 'delete') {
        if (!window.confirm('למחוק את ההערה?')) return;
        await commentsStore.remove(id);
        const idx = comments.findIndex((c) => c.id === id);
        if (idx !== -1) comments.splice(idx, 1);
      }
      await rerender();
    });
  });
}
