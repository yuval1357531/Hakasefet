// "תיקים ויומני תלמידים" -- master-only, read-only view of a student's
// personal area exactly as they see it: notebook entries (own writing +
// personal messages from ג'אוריוס) and their saved "צידה לדרך" items.
// Reuses the SAME rendering helpers the real student page uses
// (personalArea.js's notebookEntriesHTML/journalItemHTML), just fetched
// for a chosen student id instead of the logged-in session -- no new
// engine, per the "להשתמש במנוע תיק אישי הקיים" requirement. View only
// EXCEPT for two small, explicit master actions added on top:
//   1. a personal note -- goes through focusStore.create exactly like the
//      compose form on personalArea.js does (type 'pinned', no
//      broadcastId), so it renders via the SAME "מג'אוריוס" notebook
//      entry the student already sees -- no new delivery mechanism.
//   2. attaching an existing "צידה לדרך" item (an existing highlight,
//      picked lesson-first) to the student's journal -- goes through the
//      SAME journalStore.save the student's own "שמירה ליומן" button uses.
// Both bubbles are small inline panels inside this same popup (not a
// second overlay) and only ever touch the ONE open student (openStudentId
// guards every async action the same way it already guarded the initial
// fetch).

import { usersStore } from '../data/usersStore.js';
import { notebookStore } from '../data/notebookStore.js';
import { focusStore } from '../data/focusStore.js';
import { journalStore } from '../data/journalStore.js';
import { vaultStore } from '../data/vaultStore.js';
import { freedomStore } from '../data/freedomStore.js';
import { personalGuidanceStore } from '../data/personalGuidanceStore.js';
import { auth } from '../auth.js';
import { notebookEntriesHTML, journalItemHTML, wireAttachmentLinks } from './personalArea.js';
import { trailNotesForLesson, trailTextHTML, wireTrailExpand } from '../insightsTicker.js';

const SECTION_STORES = {
  vault: vaultStore,
  survivalToFreedom: freedomStore,
  personalGuidance: personalGuidanceStore,
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// How many of a student's own notebook entries were written after the
// master last opened that student's folder (profiles.journal_seen_by_
// admin_at, see usersStore.markJournalSeen) -- students with nothing new
// are simply absent from the map, so callers can just check `.get(id)`.
// Shared with router.js (the aggregate badge on the "תיקים ויומני
// תלמידים" admin-tool card) so the two badges can never drift apart.
export function computeJournalNewCounts(students, entries) {
  const counts = new Map();
  students.forEach((u) => {
    const seenAt = u.journalSeenAt ? new Date(u.journalSeenAt).getTime() : 0;
    const count = entries.filter((e) => e.studentId === u.id && new Date(e.createdAt).getTime() > seenAt).length;
    if (count > 0) counts.set(u.id, count);
  });
  return counts;
}

// Plain, clean buttons -- not a wide table, no horizontal scroll, wraps
// naturally on mobile (see .student-folder-list in dashboard.css). `count`
// (new journal entries since the master last checked) renders as a small
// quiet badge, omitted entirely when there's nothing new.
function studentButtonHTML(user, count) {
  const badge = count > 0 ? `<span class="admin-badge">${count}</span>` : '';
  return `<button type="button" class="student-folder-btn" data-id="${user.id}">${escapeHtml(user.fullName)}${badge}</button>`;
}

// --- "+" bubble 1: personal note straight into this student's journal ---

function noteBubbleHTML(isOpen) {
  if (!isOpen) return '';
  return `
    <div class="folder-bubble" id="folderNoteBubble">
      <form id="folderNoteForm" novalidate>
        <div class="field-group">
          <label for="folderNoteText">הערה אישית לתיק התלמיד/ה</label>
          <textarea id="folderNoteText" rows="3" placeholder="הערה שתופיע ביומן האישי שלו/ה, מג'אוריוס..."></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-gold small">שמירה</button>
          <button type="button" class="btn-ghost small" id="folderNoteCancel">ביטול</button>
        </div>
      </form>
    </div>`;
}

// --- "+" bubble 2: attach an existing צידה לדרך item -- step 1 picks a
// lesson (from any accessible section's existing lesson list), step 2
// picks one of that lesson's existing trail items. Never creates a new
// lesson/highlight -- only links an EXISTING one to this student, exactly
// like journalStore.save already does for a student's own click. ---------

function toolLessonPickHTML(lessons) {
  if (!lessons.length) return '<p class="placeholder-desc" style="margin:0;">אין עדיין שיעורים זמינים.</p>';
  return `<div class="student-folder-list">${lessons
    .map((l) => `<button type="button" class="student-folder-btn" data-tool-lesson-id="${l.id}" data-tool-section-id="${l.sectionId}">${escapeHtml(l.title)}</button>`)
    .join('')}</div>`;
}

function toolItemPickHTML(items, savedKeys, lessonId) {
  if (!items.length) {
    return '<p class="placeholder-desc" style="margin:0;">אין עדיין פריטי "צידה לדרך" לשיעור הזה.</p>';
  }
  return `<div class="focus-list">${items
    .map((h) => {
      const already = savedKeys.has(`${h.id}::${lessonId}`);
      return `
      <div class="focus-item">
        ${trailTextHTML(h.text)}
        <button type="button" class="btn-ghost small" data-tool-item-id="${h.id}" ${already ? 'disabled' : ''}>
          ${already ? '✓ כבר בתיק שלו/ה' : 'הוספה לתיק'}
        </button>
      </div>`;
    })
    .join('')}</div>`;
}

function toolBubbleHTML(state) {
  if (!state.open) return '';
  const body =
    state.step === 'lessons'
      ? toolLessonPickHTML(state.lessons || [])
      : `
        <button type="button" class="btn-ghost small" id="folderToolBack">← חזרה לרשימת השיעורים</button>
        <p class="admin-focus-existing-title" style="margin-top:10px;">${escapeHtml(state.selectedLesson?.title || '')}</p>
        ${toolItemPickHTML(state.items || [], state.savedKeys, state.selectedLesson?.id)}`;
  return `
    <div class="folder-bubble" id="folderToolBubble">
      <p class="muted-note" style="margin:0 0 10px;">בחר/י שיעור, ואז פריט קיים מתוך "צידה לדרך" שלו כדי לצרף אותו לתיק התלמיד/ה.</p>
      ${body}
      <div class="form-actions"><button type="button" class="btn-ghost small" id="folderToolCancel">סגירה</button></div>
    </div>`;
}

async function studentFolderBodyHTML(user, { noteOpen, toolState }) {
  const [ownEntries, focusItems, journalEntries, savedKeys] = await Promise.all([
    notebookStore.getForStudent(user.id),
    focusStore.getForStudent(user.id),
    journalStore.getForStudentWithContent(user.id),
    journalStore.getSavedKeys(user.id),
  ]);
  // Same personal-only filter the student's own notebook uses (broadcasts
  // never appear here -- those are "לוח מודעות", not this student's own
  // journal).
  const personalItems = focusItems.filter((i) => !i.broadcastId);
  const journalBody = journalEntries.length
    ? `<div class="journal-list">${journalEntries.map(journalItemHTML).join('')}</div>`
    : '<p class="placeholder-desc" style="margin:0;">עדיין לא שמר/ה כלום מ"צידה לדרך".</p>';

  return {
    html: `
    <div class="personal-block-title-row">
      <h3 class="personal-block-title notebook-block-title">תיק אישי / יומן</h3>
      <button type="button" class="folder-add-btn" id="folderAddNoteBtn" title="הוספת הערה אישית" aria-label="הוספת הערה אישית">+</button>
    </div>
    ${noteBubbleHTML(noteOpen)}
    <div class="personal-notebook admin-notebook-preview">
      <div class="notebook-entries">${notebookEntriesHTML(ownEntries, personalItems)}</div>
    </div>
    <div class="personal-block-title-row" style="margin-top:18px;">
      <h3 class="personal-block-title">צידה לדרך + הכלים שלי</h3>
      <button type="button" class="folder-add-btn" id="folderAddToolBtn" title="הוספת כלי מצידה לדרך" aria-label="הוספת כלי מצידה לדרך">+</button>
    </div>
    ${toolBubbleHTML(toolState)}
    ${journalBody}`,
    savedKeys,
  };
}

export async function mountStudentFolders(container) {
  let students = [];
  // New-journal-entry counts per student since the master last opened
  // their folder -- fetched once on mount, then patched locally (never
  // refetched) the moment a badge is cleared, same "no reload" pattern as
  // every other piece of state on this page.
  let journalCounts = new Map();
  // Guards a race where the master closes the modal (or opens a
  // different student) while the previous student's data is still being
  // fetched -- the stale response is simply discarded instead of painting
  // over whatever's now open.
  let openStudentId = null;
  let noteOpen = false;
  // Trail-tool bubble state -- lessons are fetched once (lazily, on first
  // open) and reused across students; the rest resets per open/close.
  let toolLessons = null;
  const toolState = { open: false, step: 'lessons', lessons: null, selectedLesson: null, items: [], savedKeys: new Set() };

  function render() {
    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">תיקים ויומני תלמידים</h1>
          <p class="placeholder-desc">בחר/י תלמיד/ה כדי לצפות בתיק האישי שלו/ה, בהודעות האישיות שנשלחו אליו/ה, ובמה שנשמר מ"צידה לדרך" -- לצפייה בלבד.</p>
        </div>
        <div class="student-folder-list">${
          students.length
            ? students.map((u) => studentButtonHTML(u, journalCounts.get(u.id) || 0)).join('')
            : '<p class="placeholder-desc">אין עדיין תלמידים במערכת.</p>'
        }</div>
      </div>
      <div class="personal-modal-overlay" id="studentFolderOverlay" hidden>
        <div class="personal-modal-card panel-card">
          <div class="personal-modal-header">
            <h3 class="personal-block-title" id="studentFolderTitle">תיק תלמיד</h3>
            <button type="button" class="personal-modal-close" id="studentFolderClose" aria-label="סגירה">✕</button>
          </div>
          <div class="personal-modal-body" id="studentFolderBody"></div>
        </div>
      </div>`;
    wire();
  }

  // Repaints ONLY the currently-open student's modal body -- used after
  // every bubble toggle/action so the rest of the page (student list,
  // modal open/closed state) is never touched, no reload.
  async function repaintBody() {
    const id = openStudentId;
    if (!id) return;
    const user = students.find((u) => u.id === id);
    if (!user) return;
    const body = container.querySelector('#studentFolderBody');
    // Opening/updating this popup is never "heavy" on its own (per the
    // loader's whitelist-only scope, see js/loader.js) -- this fetch is
    // small and typically instant either way.
    const { html, savedKeys } = await studentFolderBodyHTML(user, { noteOpen, toolState });
    if (openStudentId !== id) return;
    toolState.savedKeys = savedKeys;
    body.innerHTML = html;
    wireAttachmentLinks(body);
    wireTrailExpand(body);
    wireBody(user);
  }

  async function ensureToolLessons() {
    if (toolLessons) return toolLessons;
    const [vaultLessons, freedomLessons, pgLessons] = await Promise.all([
      vaultStore.lessons.getActive(),
      freedomStore.lessons.getActive(),
      personalGuidanceStore.lessons.getActive(),
    ]);
    toolLessons = [
      ...vaultLessons.map((l) => ({ id: l.id, title: l.title, sectionId: 'vault' })),
      ...freedomLessons.map((l) => ({ id: l.id, title: l.title, sectionId: 'survivalToFreedom' })),
      ...pgLessons.map((l) => ({ id: l.id, title: l.title, sectionId: 'personalGuidance' })),
    ];
    return toolLessons;
  }

  function resetBubbles() {
    noteOpen = false;
    toolState.open = false;
    toolState.step = 'lessons';
    toolState.selectedLesson = null;
    toolState.items = [];
  }

  function wireBody(user) {
    const noteBtn = container.querySelector('#folderAddNoteBtn');
    if (noteBtn) {
      noteBtn.addEventListener('click', () => {
        noteOpen = !noteOpen;
        toolState.open = false;
        repaintBody();
      });
    }
    const noteCancel = container.querySelector('#folderNoteCancel');
    if (noteCancel) noteCancel.addEventListener('click', () => { noteOpen = false; repaintBody(); });
    const noteForm = container.querySelector('#folderNoteForm');
    if (noteForm) {
      noteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textarea = container.querySelector('#folderNoteText');
        const text = textarea.value.trim();
        if (!text) return;
        const submitBtn = noteForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const session = auth.getSession();
        await focusStore.create({ studentId: user.id, type: 'pinned', title: '', text, isImportant: false, createdBy: session.id, file: null });
        submitBtn.disabled = false;
        noteOpen = false;
        await repaintBody();
      });
    }

    const toolBtn = container.querySelector('#folderAddToolBtn');
    if (toolBtn) {
      toolBtn.addEventListener('click', async () => {
        noteOpen = false;
        toolState.open = !toolState.open;
        if (toolState.open) {
          toolState.step = 'lessons';
          toolState.selectedLesson = null;
          toolState.lessons = await ensureToolLessons();
        }
        await repaintBody();
      });
    }
    const toolCancel = container.querySelector('#folderToolCancel');
    if (toolCancel) toolCancel.addEventListener('click', () => { toolState.open = false; repaintBody(); });
    const toolBack = container.querySelector('#folderToolBack');
    if (toolBack) {
      toolBack.addEventListener('click', () => {
        toolState.step = 'lessons';
        toolState.selectedLesson = null;
        repaintBody();
      });
    }
    container.querySelectorAll('[data-tool-lesson-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lessonId = btn.dataset.toolLessonId;
        const sectionId = btn.dataset.toolSectionId;
        const store = SECTION_STORES[sectionId];
        if (!store) return;
        const lesson = (toolState.lessons || []).find((l) => l.id === lessonId);
        toolState.selectedLesson = lesson;
        toolState.step = 'items';
        const highlights = await store.highlights.getActive();
        toolState.items = trailNotesForLesson(highlights, lessonId);
        await repaintBody();
      });
    });
    container.querySelectorAll('[data-tool-item-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const highlightId = btn.dataset.toolItemId;
        const lesson = toolState.selectedLesson;
        await journalStore.save({ studentId: user.id, sectionId: lesson.sectionId, highlightId, lessonId: lesson.id });
        toolState.open = false;
        await repaintBody();
      });
    });
  }

  function wire() {
    const overlay = container.querySelector('#studentFolderOverlay');
    const closeModal = () => {
      overlay.hidden = true;
      openStudentId = null;
      resetBubbles();
    };
    container.querySelector('#studentFolderClose')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    container.querySelectorAll('.student-folder-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const user = students.find((u) => u.id === id);
        if (!user) return;
        openStudentId = id;
        resetBubbles();
        container.querySelector('#studentFolderTitle').textContent = `תיק אישי: ${user.fullName}`;
        overlay.hidden = false;
        await repaintBody();
        // Opening the folder IS seeing the journal (it's the first thing
        // shown in the modal body) -- clear the badge immediately and
        // persist "seen" so it stays cleared on the next visit/device too.
        if (journalCounts.has(id)) {
          journalCounts.delete(id);
          btn.querySelector('.admin-badge')?.remove();
          await usersStore.markJournalSeen(id);
        }
      });
    });
  }

  const [allUsers, allEntries] = await Promise.all([usersStore.getAll(), notebookStore.getAll()]);
  students = allUsers.filter((u) => u.role !== 'admin');
  journalCounts = computeJournalNewCounts(students, allEntries);
  render();
}
