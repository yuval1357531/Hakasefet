// The personal page: a real routed page (mounted from router.js at '#/' and
// '#/me', the default landing spot after login) rather than a sidebar
// panel.
//
// Students see: "תיק אישי" (a notebook -- their own free-written entries,
// notebookStore.js, blended with PERSONAL messages the master sent them),
// a small "לוח מודעות ועדכונים" button (broadcasts only -- opens a
// popup, badge = unseen count), and a small "צידה לדרך + הכלים שלי"
// button (opens a popup showing journalStore.js saves). A resume-lesson
// reminder shows as a thin, full-width "continue watching" banner when
// relevant.
//
// The master sees a tiny stats line, a compose panel to post an
// announcement to one student (-> that student's notebook) or everyone
// (-> everyone's board), and a management list of what's been sent (with
// delete).

import { progressStore } from '../data/progressStore.js';
import { focusStore } from '../data/focusStore.js';
import { usersStore } from '../data/usersStore.js';
import { vaultStore } from '../data/vaultStore.js';
import { freedomStore } from '../data/freedomStore.js';
import { personalGuidanceStore } from '../data/personalGuidanceStore.js';
import { journalStore } from '../data/journalStore.js';
import { notebookStore } from '../data/notebookStore.js';
import { trailMediaHTML, trailTextHTML, wireTrailExpand } from '../insightsTicker.js';
import { accordionHTML, wireAccordions } from '../adminAccordion.js';
import {
  dailyWheelHTML,
  mountDailyWheel,
  dailyWheelManagerHTML,
  wireDailyWheelManager,
  dailyWheelSentencesModalHTML,
  wireDailyWheelSentencesModal,
} from '../dailyWheel.js';
import { dailyWheelStore } from '../data/dailyWheelStore.js';
import { loginEventsStore, computeSecurityAlerts } from '../data/loginEventsStore.js';
import { helpTipHTML } from '../helpTip.js';

const RESUME_DISMISS_KEY = 'vault_resume_dismissed_lesson';
const BOARD_SEEN_KEY_PREFIX = 'personal_board_seen_';

function boardSeenAt(session) {
  return localStorage.getItem(BOARD_SEEN_KEY_PREFIX + session.id);
}

function markBoardSeen(session) {
  localStorage.setItem(BOARD_SEEN_KEY_PREFIX + session.id, new Date().toISOString());
}

// "12 בנובמבר, 14:32" -- compact, diary-style timestamp for a single entry.
function formatEntryTime(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
  const timePart = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

// "יום שלישי, 12 בנובמבר" -- the notebook's own small top-corner date, like
// today's page in a real notebook.
function todayLabel() {
  return new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
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

export function firstName(name) {
  return (name || 'משתמש').trim().split(/\s+/)[0];
}

async function loadAccessibleLessons(session) {
  const canVault = session.role === 'admin' || session.permissions.vault;
  const canFreedom = session.role === 'admin' || session.permissions.survivalToFreedom;
  const canPersonalGuidance = session.role === 'admin' || session.permissions.personalGuidance;
  const [vaultLessons, freedomLessons, pgLessons] = await Promise.all([
    canVault ? vaultStore.lessons.getActive() : Promise.resolve([]),
    canFreedom ? freedomStore.lessons.getActive() : Promise.resolve([]),
    canPersonalGuidance ? personalGuidanceStore.lessons.getActive() : Promise.resolve([]),
  ]);
  const lessons = [];
  vaultLessons.forEach((l) => lessons.push({ id: l.id, title: l.title, sectionId: 'vault' }));
  freedomLessons.forEach((l) => lessons.push({ id: l.id, title: l.title, sectionId: 'survivalToFreedom' }));
  pgLessons.forEach((l) => lessons.push({ id: l.id, title: l.title, sectionId: 'personalGuidance' }));
  return lessons;
}

// Only the "pick up where you left off" reminder -- deliberately NOT a
// progress dashboard (X/Y lessons completed etc.): there is no real video
// player wired in yet, so there's no actual watched-percentage/position
// to show (see progressStore.js's own note on this) -- a "continue
// watching" CARD, not a percentage bar. Full page width, but very low
// height (a thin banner, not a block that costs vertical space), sitting
// between the board button and the notebook. Returns { html: '' } when
// there's no relevant lesson to resume, so the caller never renders an
// empty banner.
async function resumeBannerHTML(session) {
  const [lessons, progress] = await Promise.all([loadAccessibleLessons(session), progressStore.getForUser(session.id)]);
  const byLessonId = new Map(progress.map((p) => [p.lessonId, p]));

  let resume = null;
  for (const l of lessons) {
    const p = byLessonId.get(l.id);
    if (p && !p.isCompleted && p.lastWatchedAt) {
      if (!resume || new Date(p.lastWatchedAt) > new Date(resume.progress.lastWatchedAt)) resume = { lesson: l, progress: p };
    }
  }

  const dismissedId = sessionStorage.getItem(RESUME_DISMISS_KEY);
  const showResume = resume && resume.lesson.id !== dismissedId;
  if (!showResume) return { html: '', resumeLessonId: null };

  return {
    html: `
    <div class="personal-resume-banner" data-section="${resume.lesson.sectionId}">
      <a class="personal-resume-main" href="#/${resume.lesson.sectionId}/lesson/${resume.lesson.id}" id="resumeContinueLink">
        <span class="personal-resume-thumb" aria-hidden="true">▶</span>
        <span class="personal-resume-text">
          <span class="personal-resume-label">המשך צפייה</span>
          <span class="personal-resume-title">${escapeHtml(resume.lesson.title)}</span>
        </span>
      </a>
      <button type="button" class="personal-resume-dismiss" id="resumeDismissBtn" aria-label="לא עכשיו" title="לא עכשיו">✕</button>
    </div>`,
    resumeLessonId: resume.lesson.id,
  };
}

// A small inline SVG (currentColor) instead of the "📎" emoji -- an emoji
// glyph carries its own baked-in colour from the OS/browser's emoji font
// (usually a flat grey/white paperclip) that CSS `color` can't touch, so
// it always read as disconnected from the crystal-blue theme even though
// the button's own text/border already were themed. Same markup/behaviour
// otherwise (still just a plain themed button).
function attachmentHTML(item) {
  if (!item.attachmentPath) return '';
  const icon = `<svg class="focus-attachment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`;
  return `<button type="button" class="focus-attachment-link" data-path="${escapeAttr(item.attachmentPath)}">${icon}${escapeHtml(item.attachmentName || 'קובץ מצורף')}</button>`;
}

// One tag, unambiguous either way: gold/subtle for "הודעה לכולם" (matches
// the site's own crystal-gold accent, never shouty), neutral for a
// personal one-to-one announcement. Shown identically to the student and
// to the master's own management list, so it's always clear at a glance
// which is which.
function audienceTagHTML(item) {
  return item.broadcastId
    ? '<span class="focus-audience-tag tag-broadcast">הודעה לכולם</span>'
    : '<span class="focus-audience-tag tag-personal">הודעה אישית</span>';
}

// Renders one announcement. `forAdmin` swaps the student's actionable
// "בוצע" button for a read-only status label -- only the student
// themselves marks a task done; the master only ever observes the result.
function focusItemHTML(item, { forAdmin = false } = {}) {
  const importantClass = item.isImportant ? ' is-important' : '';
  const titleHTML = item.title ? `<span class="focus-item-title">${escapeHtml(item.title)}</span>` : '';

  if (item.type === 'pinned') {
    return `
      <div class="focus-item focus-pinned${importantClass}">
        <div class="focus-item-meta">
          ${titleHTML}
          ${audienceTagHTML(item)}
        </div>
        <p class="focus-item-text">${escapeHtml(item.text)}</p>
        ${attachmentHTML(item)}
      </div>`;
  }

  const statusHTML = forAdmin
    ? `<span class="focus-task-status ${item.status === 'done' ? 'is-done' : ''}">${item.status === 'done' ? '✓ בוצע' : 'פתוח'}</span>`
    : item.status === 'done'
      ? '<span class="focus-task-done">✓ בוצע</span>'
      : `<button type="button" class="btn-gold small focus-done-btn" data-id="${item.id}">בוצע</button>`;

  return `
    <div class="focus-item focus-task ${item.status === 'done' ? 'is-done' : ''}${importantClass}" data-id="${item.id}">
      <div class="focus-item-meta">
        ${titleHTML}
        ${audienceTagHTML(item)}
      </div>
      <p class="focus-item-text">${escapeHtml(item.text)}</p>
      ${attachmentHTML(item)}
      ${statusHTML}
    </div>`;
}

export function journalItemHTML(entry) {
  const lessonLink = entry.lessonTitle
    ? `<a class="journal-lesson-link" href="#/${entry.sectionId}/lesson/${entry.lessonId}">${escapeHtml(entry.lessonTitle)} ←</a>`
    : '';
  return `
    <div class="journal-item">
      <div class="journal-item-main">
        ${trailTextHTML(entry.highlight.text, 'journal-item-text')}
        ${lessonLink ? `<div class="journal-item-source">מהשיעור: ${lessonLink}</div>` : ''}
      </div>
      ${trailMediaHTML(entry.highlight.mediaUrl)}
    </div>`;
}

export function wireAttachmentLinks(root) {
  root.querySelectorAll('.focus-attachment-link').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = await focusStore.getAttachmentDownloadUrl(btn.dataset.path);
      if (url) window.open(url, '_blank', 'noopener');
    });
  });
}

// --- "תיק אישי" -- the notebook: the student's own free-written entries
// blended chronologically (newest first) with PERSONAL messages from the
// master (broadcastId falsy -- see composeFormHTML's "שליחה אל" picker).
// Broadcasts ("הודעה לכולם") never appear here -- those live only in
// "לוח מודעות ועדכונים" (see boardModalHTML). Plain flowing entries, no
// per-entry card -- only a master entry gets a quiet accent so it still
// reads as "from ג'אוריוס" without breaking the notebook feel. -----------

// Two-column ruled-ledger row: time in the narrow right margin (see
// .notebook-entries::before for the continuous vertical line), the
// entry's own content to its left -- see css/dashboard.css's note on
// .notebook-entries for the full reasoning.
function notebookOwnEntryHTML(entry) {
  return `
    <div class="notebook-entry-row">
      <span class="notebook-entry-time">${formatEntryTime(entry.createdAt)}</span>
      <div class="notebook-entry-body">
        <p class="notebook-entry-text">${escapeHtml(entry.text)}</p>
      </div>
    </div>`;
}

// Reuses the existing task/status affordance (.focus-done-btn) so marking
// a personal task done from inside the notebook is wired for free by the
// same querySelectorAll wireStudentHandlers already does -- no new
// wiring needed just because the item now renders in a different spot.
function notebookMasterEntryHTML(item) {
  const titleHTML = item.title ? `<span class="notebook-entry-title">${escapeHtml(item.title)}</span>` : '';
  const statusHTML =
    item.type === 'task'
      ? item.status === 'done'
        ? '<span class="focus-task-done">✓ בוצע</span>'
        : `<button type="button" class="btn-ghost small focus-done-btn" data-id="${item.id}">בוצע</button>`
      : '';
  return `
    <div class="notebook-entry-row notebook-entry-master">
      <span class="notebook-entry-time">${formatEntryTime(item.createdAt)}</span>
      <div class="notebook-entry-body">
        <span class="notebook-entry-tag">מג'אוריוס</span>
        ${titleHTML}
        <p class="notebook-entry-text">${escapeHtml(item.text)}</p>
        ${attachmentHTML(item)}
        ${statusHTML}
      </div>
    </div>`;
}

// `focusItems` here is ALREADY filtered to personal-only (see
// studentPageHTML) -- this just merges + sorts + renders.
export function notebookEntriesHTML(ownEntries, personalFocusItems) {
  const merged = [
    ...ownEntries.map((e) => ({ ...e, kind: 'own' })),
    ...personalFocusItems.map((i) => ({ ...i, kind: 'master' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (!merged.length) {
    return '<p class="notebook-empty">כאן יירשמו הדברים</p>';
  }
  return merged.map((item) => (item.kind === 'master' ? notebookMasterEntryHTML(item) : notebookOwnEntryHTML(item))).join('');
}

// Heading + "צידה לדרך + הכלים שלי" share one header row, then a thin
// divider starts the journal proper (item 13) -- the trail button moved
// here from its old standalone spot below the whole block; its id/wiring
// (#trailToolsOpenBtn, wireStudentHandlers) are untouched, so it still
// works no matter where in the DOM it renders.
function notebookHTML(ownEntries, personalFocusItems) {
  return `
    <div class="personal-notebook-block">
      <div class="personal-notebook-header">
        <span class="personal-help-row">
          <h3 class="personal-block-title notebook-block-title">יומן אישי</h3>
          ${helpTipHTML('journal', 'זה המקום שלך לתעד תובנות, מחשבות, חוויות והבנות שעולות מהדרך. זה לא צריך להיות מושלם — המטרה היא לתפוס את עצמך בזמן אמת ולעקוב אחרי ההתפתחות שלך. היומן נשמר באזור האישי שלך; יובל יכול לראות אותו לצורך ליווי והתפתחות, תוך שמירה על דיסקרטיות מלאה.')}
        </span>
      </div>
      <div class="personal-notebook-divider" aria-hidden="true"></div>
      <div class="personal-notebook-subrow">
        <span class="personal-help-row">
          <button type="button" class="personal-trail-btn" id="trailToolsOpenBtn">צידה לדרך + הכלים שלי</button>
          ${helpTipHTML('trail-tools', 'כאן נשמרים כלים, תרגולים ותובנות שבחרת לשמור מתוך השיעורים. זה המקום לחזור אליו כשאתה רוצה להוריד לקרקע את מה שלמדת ולהשתמש בכלים שיובל תמצת לך. חשוב: הכלים והתבניות הם עזר, לא תחליף לאינטגרציה אמיתית בחיים. המטרה שלהם היא לעזור לך לחיות את החומר — עד שלא תצטרך להישען עליהם.')}
        </span>
      </div>
      <div class="notebook-topline"><span class="notebook-date">${todayLabel()}</span></div>
      <div class="notebook-compose">
        <textarea id="notebookInput" class="notebook-textarea" rows="2" placeholder="כתוב כאן תובנה, מחשבה, חוויה או הערה..."></textarea>
        <button type="button" class="notebook-save-btn" id="notebookSaveBtn" aria-label="שמירה" title="שמירה">✓</button>
      </div>
      <div class="notebook-entries" id="notebookEntries">${notebookEntriesHTML(ownEntries, personalFocusItems)}</div>
    </div>`;
}

// --- "לוח מודעות ועדכונים" -- small button (badge = unseen broadcasts)
// that opens a popup instead of taking page width. Only broadcasts
// (item.broadcastId truthy -- "הודעה לכולם") ever show here; personal
// messages live in the notebook instead (see above). ---------------------

function personalBoardButtonHTML(unseenCount) {
  const badge = unseenCount > 0 ? `<span class="personal-badge">${unseenCount}</span>` : '';
  return `
    <span class="personal-help-row">
      <button type="button" class="personal-board-btn" id="boardOpenBtn">
        לוח מודעות ועדכונים${badge}
      </button>
      ${helpTipHTML('board', 'כאן יופיעו עדכונים חשובים מהמערכת או מיובל. חלקם כלליים לכל חברי הכספת, וחלקם אישיים ומיועדים אליך. הודעות אישיות מיובל יופיעו גם ביומן האישי שלך כדי שלא תפספס אותן.')}
    </span>`;
}

function personalModalHTML(id, title, bodyHTML, isOpen) {
  return `
    <div class="personal-modal-overlay" id="${id}Overlay" ${isOpen ? '' : 'hidden'}>
      <div class="personal-modal-card panel-card">
        <div class="personal-modal-header">
          <h3 class="personal-block-title">${escapeHtml(title)}</h3>
          <button type="button" class="personal-modal-close" id="${id}Close" aria-label="סגירה">✕</button>
        </div>
        <div class="personal-modal-body">${bodyHTML}</div>
      </div>
    </div>`;
}

function boardModalHTML(broadcastItems, isOpen) {
  const body = broadcastItems.length
    ? `<div class="focus-list">${broadcastItems.map((i) => focusItemHTML(i)).join('')}</div>`
    : '<p class="placeholder-desc" style="margin:0;">עדיין אין הודעות.</p>';
  return personalModalHTML('board', 'לוח מודעות ועדכונים', body, isOpen);
}

// --- "דיוק יומי" -- the daily-wheel widget, relocated out of the main
// content flow and into its own left-side drawer (mirrors the main nav
// sidebar's own fixed/overlay/transform mechanism, just on the opposite
// edge and scoped to this page only -- see wireWheelDrawer below and its
// CSS). The wheel's own spin/reveal/24h-lock logic (dailyWheel.js) is
// completely untouched; only WHERE it renders changes. The closed tab
// shows the live countdown via mountDailyWheel's onLockChange hook. ------

function wheelDrawerHTML(isOpen) {
  return `
    <div class="wheel-drawer-root${isOpen ? ' is-open' : ''}" id="wheelDrawerRoot">
      <button type="button" class="wheel-tab" id="wheelTabBtn" aria-label="דיוק יומי" aria-expanded="${isOpen ? 'true' : 'false'}">
        <span class="wheel-tab-mark" aria-hidden="true">◆</span>
        <span class="wheel-tab-timer" id="wheelTabTimer"></span>
      </button>
      <div class="wheel-drawer-overlay" id="wheelDrawerOverlay"></div>
      <div class="wheel-drawer panel-card" id="wheelDrawer" role="dialog" aria-label="דיוק יומי" aria-hidden="${isOpen ? 'false' : 'true'}">
        <div class="wheel-drawer-swipe-hint" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="wheel-drawer-header">
          <span class="personal-help-row">
            <h2 class="gold-title wheel-drawer-title">דיוק יומי</h2>
            ${helpTipHTML('daily-wheel', 'כאן אפשר לקבל דיוק יומי קצר פעם ב-24 שעות. זה משפט או כיוון קטן שנועד לפתוח לך נקודת מחשבה להיום.')}
          </span>
          <button type="button" class="personal-modal-close" id="wheelDrawerClose" aria-label="סגירה">✕</button>
        </div>
        <div class="wheel-drawer-body">${dailyWheelHTML()}</div>
      </div>
    </div>`;
}

// --- "צידה לדרך + הכלים שלי" -- same popup treatment, showing what the
// student already saved from lessons (journalStore, unchanged -- just
// relocated out of the main page flow and into this popup). -------------

function trailModalHTML(journalEntries, isOpen) {
  const body = journalEntries.length
    ? `<div class="journal-list">${journalEntries.map(journalItemHTML).join('')}</div>`
    : '<p class="placeholder-desc" style="margin:0;">עדיין לא שמרת כלום. בכל שיעור, ב"צידה לדרך", אפשר לשמור תובנה או פרקטיקה לכאן.</p>';
  return personalModalHTML('trail', 'צידה לדרך + הכלים שלי', body, isOpen);
}

export async function studentPageHTML(session, { boardModalOpen, trailModalOpen, wheelDrawerOpen }) {
  const [{ html: resumeHTML, resumeLessonId }, ownEntries, focusItems, journalEntries] = await Promise.all([
    resumeBannerHTML(session),
    notebookStore.getForStudent(session.id),
    focusStore.getForStudent(session.id),
    journalStore.getForStudentWithContent(session.id),
  ]);
  const broadcastItems = focusItems.filter((i) => i.broadcastId);
  const personalItems = focusItems.filter((i) => !i.broadcastId);
  const seenAt = boardSeenAt(session);
  const unseenCount = broadcastItems.filter((i) => !seenAt || new Date(i.createdAt) > new Date(seenAt)).length;

  return {
    html: `
    <div class="admin-page personal-page">
      <div class="admin-page-header personal-page-header">
        <h1 class="gold-title placeholder-title">שלום, ${escapeHtml(firstName(session.fullName || session.username))} האגדי</h1>
        <img src="assets/jaurius-mask-logo-240.png" alt="" class="personal-page-icon">
      </div>
      <div class="personal-topbar">
        ${personalBoardButtonHTML(unseenCount)}
      </div>
      ${resumeHTML}
      ${notebookHTML(ownEntries, personalItems)}
    </div>
    ${boardModalHTML(broadcastItems, boardModalOpen)}
    ${trailModalHTML(journalEntries, trailModalOpen)}
    ${wheelDrawerHTML(wheelDrawerOpen)}`,
    resumeLessonId,
  };
}

// Small, quiet indicator line -- deliberately not a card/block, just text
// above the heading, per the "קטן, עדין, לא בלוק גדול" requirement.
function statsLineHTML(students) {
  const activeCount = students.filter((u) => u.status !== 'blocked').length;
  return `<p class="personal-mini-stats">חברי הכספת: ${activeCount} · ליווי אישי: בקרוב</p>`;
}

function composeFormHTML(students, isOpen) {
  const options = students
    .map((u) => `<option value="${escapeAttr(u.id)}">${escapeHtml(u.fullName)} — ${escapeHtml(u.username)}</option>`)
    .join('');
  return accordionHTML(
    'compose-focus',
    'ניהול ושליחת עדכונים',
    `
      <p class="muted-note admin-focus-subtitle">ריק = לוח מודעות ועדכונים לכולם · תלמיד נבחר = נכנס לתיק האישי שלו</p>
      <form id="focusComposeForm" novalidate>
        <div class="field-group">
          <label for="focusTitleInput">כותרת (אופציונלי)</label>
          <input type="text" id="focusTitleInput" placeholder="כותרת קצרה...">
        </div>
        <div class="field-group">
          <label for="focusTextInput">תוכן ההודעה</label>
          <textarea id="focusTextInput" rows="3" placeholder="מה תרצה לשלוח?"></textarea>
        </div>
        <div class="field-group">
          <label for="focusTypeSelect">סוג</label>
          <select id="focusTypeSelect">
            <option value="pinned">הודעה מוצמדת</option>
            <option value="task">משימה / יעד</option>
          </select>
        </div>
        <div class="field-group">
          <label for="focusStudentSelect">שליחה אל <span class="muted-note">(ריק = הודעה לכולם)</span></label>
          <select id="focusStudentSelect">
            <option value="">כל התלמידים</option>
            ${options}
          </select>
        </div>
        <div class="field-group">
          <label for="focusAttachmentInput">קובץ מצורף (אופציונלי)</label>
          <input type="file" id="focusAttachmentInput">
        </div>
        <label class="focus-important-toggle">
          <input type="checkbox" id="focusImportantCheckbox"> סמן כחשוב
        </label>
        <div class="error-msg" id="focusSendError" role="alert"></div>
        <div class="form-actions"><button type="submit" class="btn-gold small">שליחה</button></div>
      </form>
      <div class="admin-focus-existing" id="focusExistingList"></div>
      <button type="button" class="btn-ghost small recent-sent-open-btn" id="recentSentOpenBtn">מה נשלח לאחרונה</button>`,
    { isOpen, titleClass: 'personal-block-title', extraCardClass: 'admin-focus-block' }
  );
}

function groupSentItems(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.broadcastId || item.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.values());
}

function adminRecentRowHTML(group, studentNameById) {
  const rep = group[0];
  const doneCount = group.filter((i) => i.status === 'done').length;
  const statusLabel = rep.type === 'task' ? `${doneCount}/${group.length} בוצע` : 'הודעה מוצמדת';
  const titleHTML = rep.title ? `<span class="focus-item-title">${escapeHtml(rep.title)}</span>` : '';
  const recipientLabel = rep.broadcastId ? '' : `<span class="focus-recipient">אל: ${escapeHtml(studentNameById.get(rep.studentId) || 'תלמיד')}</span>`;
  // data-key groups every fan-out row of a broadcast under one edit/
  // delete action -- see wireRecentSentRowActions, which acts on the
  // whole group at once either way.
  return `
    <div class="focus-item ${rep.isImportant ? 'is-important' : ''}" data-key="${escapeAttr(rep.broadcastId || rep.id)}">
      <div class="focus-item-meta">
        ${titleHTML}
        ${audienceTagHTML(rep)}
        ${recipientLabel}
      </div>
      <p class="focus-item-text">${escapeHtml(rep.text)}</p>
      ${attachmentHTML(rep)}
      <div class="focus-item-footer">
        <span class="focus-task-status ${rep.type === 'task' && doneCount === group.length ? 'is-done' : ''}">${statusLabel}</span>
        <button type="button" class="btn-ghost small" data-action="edit-announcement">עריכה</button>
        <button type="button" class="btn-ghost small danger" data-action="delete-announcement">מחיקה</button>
      </div>
    </div>`;
}

// In-place edit form for one announcement group -- same field shape as
// the compose form above (title + text), pre-filled. Submitting updates
// every recipient's row at once (focusStore.updateGroup), matching how
// removeGroup already deletes a whole broadcast as one unit.
function adminRecentRowEditFormHTML(group) {
  const rep = group[0];
  return `
    <div class="focus-item" data-key="${escapeAttr(rep.broadcastId || rep.id)}">
      <form class="recent-edit-form" novalidate>
        <div class="field-group">
          <label>כותרת</label>
          <input type="text" class="recent-edit-title" value="${escapeAttr(rep.title || '')}">
        </div>
        <div class="field-group">
          <label>תוכן</label>
          <textarea class="recent-edit-text" rows="3">${escapeHtml(rep.text)}</textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-gold small">שמירה</button>
          <button type="button" class="btn-ghost small" data-action="cancel-edit-announcement">ביטול</button>
        </div>
      </form>
    </div>`;
}

function recentSentBodyHTML(items, studentNameById, editingKey) {
  const groups = groupSentItems(items).slice(0, 8);
  return groups.length
    ? `<div class="focus-list" id="recentSentList">${groups
        .map((g) => {
          const key = g[0].broadcastId || g[0].id;
          return key === editingKey ? adminRecentRowEditFormHTML(g) : adminRecentRowHTML(g, studentNameById);
        })
        .join('')}</div>`
    : '<p class="placeholder-desc" style="margin:0;">עדיין לא נשלח כאן כלום.</p>';
}

// "מה נשלח לאחרונה" -- now a small trigger row INSIDE "ניהול ושליחת
// עדכונים" (see composeFormHTML's #recentSentOpenBtn) that opens this as
// a popup, instead of a permanently-expanded card taking page space.
// Reuses the same personalModalHTML shell the student-facing board/trail
// popups already use.
function recentSentModalHTML(items, studentNameById, isOpen, editingKey) {
  return personalModalHTML('recentSent', 'מה נשלח לאחרונה', recentSentBodyHTML(items, studentNameById, editingKey), isOpen);
}

// "התראות אבטחה" -- title (right) + "הרץ בדיקת אבטחה" (left) above a thin
// full-width status strip. The strip itself is only ever a summary; a
// click (when there ARE alerts) opens the same personalModalHTML shell
// every other popup on this page already uses, listing each flagged
// student + reason. Never locks/blocks anyone -- purely informational,
// per the "רק להציג התראה למאסטר" requirement.
function securityAlertsHTML(alerts, isBubbleOpen) {
  const hasAlerts = alerts.length > 0;
  const stripHTML = hasAlerts
    ? `<button type="button" class="security-alerts-strip has-alerts" id="securityAlertsStripBtn">⚠ ${alerts.length} התראות אבטחה פתוחות — לחיצה לפירוט</button>`
    : '<div class="security-alerts-strip is-clear">✓ אין התראות אבטחה פתוחות</div>';
  const bubbleBody = hasAlerts
    ? `<div class="focus-list">${alerts
        .map((a) => `<div class="focus-item"><span class="focus-item-title">${escapeHtml(a.fullName)}</span><p class="focus-item-text">${escapeHtml(a.reason)}</p></div>`)
        .join('')}</div>`
    : '';
  return `
    <div class="security-alerts-block">
      <div class="security-alerts-header">
        <h3 class="personal-block-title">התראות אבטחה</h3>
        <button type="button" class="btn-ghost small" id="runSecurityCheckBtn">הרץ בדיקת אבטחה</button>
      </div>
      ${stripHTML}
    </div>
    ${hasAlerts ? personalModalHTML('securityAlerts', 'התראות אבטחה', bubbleBody, isBubbleOpen) : ''}`;
}

function masterPageHTML(
  students,
  recentItems,
  studentNameById,
  isComposeOpen,
  recentSentModalOpen,
  editingAnnouncementKey,
  wheelSentences,
  isWheelManagerOpen,
  editingWheelSentence,
  wheelSentencesModalOpen,
  securityAlerts,
  securityBubbleOpen
) {
  return `
    <div class="admin-page personal-page personal-page-master">
      ${statsLineHTML(students)}
      <div class="admin-page-header personal-page-header">
        <h1 class="gold-title placeholder-title">שלום ג'אוריוס האגדי</h1>
        <img src="assets/jaurius-mask-logo-240.png" alt="" class="personal-page-icon">
      </div>
      <div class="personal-page-actions">
        <a href="#/admin" class="admin-manage-link">ניהול מערכת ומשתמשים</a>
      </div>
      ${securityAlertsHTML(securityAlerts, securityBubbleOpen)}
      ${composeFormHTML(students, isComposeOpen)}
      ${accordionHTML(
        'daily-wheel-sentences',
        'ניהול משפטים לרכיב היומי',
        dailyWheelManagerHTML({ sentences: wheelSentences, editing: editingWheelSentence }),
        { isOpen: isWheelManagerOpen, titleClass: 'personal-block-title' }
      )}
    </div>
    ${recentSentModalHTML(recentItems, studentNameById, recentSentModalOpen, editingAnnouncementKey)}
    ${dailyWheelSentencesModalHTML(wheelSentences, wheelSentencesModalOpen)}`;
}

export async function mountPersonalPage(container, session) {
  // Whether the master's "ניהול עדכונים" panel is open -- kept across
  // re-renders (sending a message re-renders the whole page).
  const openAccordions = new Set();
  // The master's own already-fetched "recently sent" rows, kept in local
  // closure state so deleting one announcement can patch this list and
  // repaint just that card -- no network refetch, no page reload.
  let recentItemsCache = [];
  let studentNameByIdCache = new Map();
  // Master-only: "מה נשלח לאחרונה" popup open state + which announcement
  // (if any) is currently shown as an edit form -- kept across the local
  // render() calls other master actions already trigger, same reasoning
  // as the student popup state below.
  let recentSentModalOpen = false;
  let editingAnnouncementKey = null;
  // Master-only: the daily-wheel sentence bank, kept in local closure state
  // like every other management list on this page so add/edit/delete never
  // needs a network refetch to repaint.
  let wheelSentencesCache = [];
  let editingWheelSentenceId = null;
  // Master-only: whether the "משפטים קיימים" compact-list modal is open --
  // same closure-state pattern as every other popup on this page.
  let wheelSentencesModalOpen = false;
  // Master-only: basic multi-device security-alert heuristic (see
  // data/loginEventsStore.js's computeSecurityAlerts). Computed once on
  // mount and again on demand via "הרץ בדיקת אבטחה" -- both times a plain
  // local repaint of just this block, never a full page reload.
  let securityAlertsCache = [];
  let securityBubbleOpen = false;
  let securityChecked = false;
  // Student-only: whether each popup is open -- kept across the local
  // render() calls other student actions already trigger (mark task
  // done, resume dismiss, notebook save), so none of those accidentally
  // close a popup the student has open.
  let boardModalOpen = false;
  let trailModalOpen = false;
  // Student-only: the "דיוק יומי" left-side drawer's open/closed state --
  // kept across the same local render() calls as the two popups above, for
  // the same reason (an unrelated action re-rendering the page must never
  // silently close a drawer the student has open).
  let wheelDrawerOpen = false;

  async function render() {
    if (session.role === 'admin') {
      // A single broadcast to every student already fans out into one row
      // per student (see focusStore.createBroadcast), so with a school of
      // ~100 students one broadcast alone is ~100 rows -- fetch enough raw
      // rows that "last 8 sent items" below still covers several sends,
      // not just the latest one or two.
      const [allUsers, recentItems, wheelSentences] = await Promise.all([
        usersStore.getAll(),
        focusStore.getSentByAdmin(1000),
        dailyWheelStore.sentences.getAll(),
      ]);
      const students = allUsers.filter((u) => u.role !== 'admin');
      studentNameByIdCache = new Map(students.map((u) => [u.id, u.fullName]));
      recentItemsCache = recentItems;
      wheelSentencesCache = wheelSentences;
      // Security check runs automatically once on the page's first load,
      // then only again on demand ("הרץ בדיקת אבטחה") -- NOT on every
      // render() this page already triggers for unrelated actions (sending
      // a message, editing a wheel sentence, ...), which would otherwise
      // needlessly re-fetch the full login_events table each time.
      if (!securityChecked) {
        securityChecked = true;
        const usersById = new Map(allUsers.map((u) => [u.id, u.fullName]));
        const events = await loginEventsStore.getAll();
        securityAlertsCache = computeSecurityAlerts(events, usersById);
      }
      const editingWheelSentence = editingWheelSentenceId
        ? wheelSentencesCache.find((s) => s.id === editingWheelSentenceId)
        : null;
      container.innerHTML = masterPageHTML(
        students,
        recentItemsCache,
        studentNameByIdCache,
        openAccordions.has('compose-focus'),
        recentSentModalOpen,
        editingAnnouncementKey,
        wheelSentencesCache,
        openAccordions.has('daily-wheel-sentences'),
        editingWheelSentence,
        wheelSentencesModalOpen,
        securityAlertsCache,
        securityBubbleOpen
      );
      wireMasterHandlers();
      wireAccordions(container, { state: openAccordions, rerender: render });
    } else {
      const { html, resumeLessonId } = await studentPageHTML(session, { boardModalOpen, trailModalOpen, wheelDrawerOpen });
      container.innerHTML = html;
      wireStudentHandlers(resumeLessonId);
      wireTrailExpand(container);
      wireWheelDrawer();
      const tabTimerEl = container.querySelector('#wheelTabTimer');
      mountDailyWheel(container.querySelector('#dailyWheel'), session, (display) => {
        if (tabTimerEl) tabTimerEl.textContent = display || 'זמין';
      });
    }
    wireAttachmentLinks(container);
  }

  // Repaints ONLY the "מה נשלח לאחרונה" popup body from the current
  // in-memory list -- used after edit/delete so the rest of the page
  // (compose form, stats, accordion open/closed state) is never touched.
  function repaintRecentSentList() {
    const body = container.querySelector('#recentSentOverlay .personal-modal-body');
    if (!body) return;
    body.innerHTML = recentSentBodyHTML(recentItemsCache, studentNameByIdCache, editingAnnouncementKey);
    wireRecentSentRowActions();
    wireAttachmentLinks(body);
  }

  function wireRecentSentRowActions() {
    container.querySelectorAll('[data-action="edit-announcement"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingAnnouncementKey = btn.closest('[data-key]').dataset.key;
        repaintRecentSentList();
      });
    });
    container.querySelectorAll('[data-action="cancel-edit-announcement"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingAnnouncementKey = null;
        repaintRecentSentList();
      });
    });
    container.querySelectorAll('.recent-edit-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = form.closest('[data-key]').dataset.key;
        const title = form.querySelector('.recent-edit-title').value.trim();
        const text = form.querySelector('.recent-edit-text').value.trim();
        if (!text) return;
        const group = recentItemsCache.filter((i) => (i.broadcastId || i.id) === key);
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const ok = await focusStore.updateGroup(group, { title, text });
        submitBtn.disabled = false;
        if (ok) {
          recentItemsCache = recentItemsCache.map((i) => ((i.broadcastId || i.id) === key ? { ...i, title, text } : i));
          editingAnnouncementKey = null;
        }
        repaintRecentSentList();
      });
    });
    container.querySelectorAll('[data-action="delete-announcement"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.closest('[data-key]').dataset.key;
        if (!window.confirm('אתה בטוח שאתה רוצה למחוק את ההודעה?')) return;
        const group = recentItemsCache.filter((i) => (i.broadcastId || i.id) === key);
        btn.disabled = true;
        const ok = await focusStore.removeGroup(group);
        if (ok) {
          recentItemsCache = recentItemsCache.filter((i) => (i.broadcastId || i.id) !== key);
          repaintRecentSentList();
        } else {
          btn.disabled = false;
        }
      });
    });
  }

  // "דיוק יומי" left-side drawer -- open/close (tab, X, overlay click) plus
  // a mobile swipe-left-to-close gesture. Purely a shell around the
  // untouched daily-wheel widget already mounted inside it; none of this
  // reads or changes the 24h lock state.
  function wireWheelDrawer() {
    const root = container.querySelector('#wheelDrawerRoot');
    const tab = container.querySelector('#wheelTabBtn');
    const overlay = container.querySelector('#wheelDrawerOverlay');
    const drawer = container.querySelector('#wheelDrawer');
    const closeBtn = container.querySelector('#wheelDrawerClose');
    if (!root || !tab || !overlay || !drawer) return;

    function setOpen(open) {
      wheelDrawerOpen = open;
      root.classList.toggle('is-open', open);
      tab.setAttribute('aria-expanded', open ? 'true' : 'false');
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    tab.addEventListener('click', () => setOpen(true));
    overlay.addEventListener('click', () => setOpen(false));
    if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));

    // Swipe-to-close (mobile): the drawer sits at translateX(0) when open
    // (see CSS), so dragging further left is a natural, direct extension
    // of that same axis -- follow the finger 1:1 with no transition while
    // dragging, then either finish the close or spring back open, both
    // using the drawer's normal CSS transition for the same weighted,
    // no-bounce settle every other panel in the app already uses.
    let dragging = false;
    let startX = 0;
    let currentDx = 0;
    const CLOSE_THRESHOLD = 90; // px of leftward drag that commits to closing

    drawer.addEventListener('pointerdown', (e) => {
      if (!root.classList.contains('is-open')) return;
      // Ignore drags starting on interactive controls (the handle, inputs,
      // buttons) so a press-and-hold on the wheel's own handle never gets
      // mistaken for a swipe.
      if (e.target.closest('button, input, textarea, a')) return;
      dragging = true;
      startX = e.clientX;
      currentDx = 0;
      drawer.classList.add('is-dragging');
      drawer.setPointerCapture(e.pointerId);
    });
    drawer.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      currentDx = Math.min(0, e.clientX - startX);
      drawer.style.transform = `translateX(${currentDx}px)`;
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      drawer.classList.remove('is-dragging');
      drawer.style.transform = '';
      if (Math.abs(currentDx) >= CLOSE_THRESHOLD) setOpen(false);
      currentDx = 0;
    }
    drawer.addEventListener('pointerup', endDrag);
    drawer.addEventListener('pointercancel', endDrag);
  }

  function wireStudentHandlers(resumeLessonId) {
    const resumeDismiss = container.querySelector('#resumeDismissBtn');
    if (resumeDismiss) {
      resumeDismiss.addEventListener('click', (e) => {
        e.preventDefault();
        if (resumeLessonId) sessionStorage.setItem(RESUME_DISMISS_KEY, resumeLessonId);
        render();
      });
    }

    container.querySelectorAll('.focus-done-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await focusStore.markDone(btn.dataset.id);
        render();
      });
    });

    // "לוח מודעות ועדכונים" popup -- opening it marks every broadcast seen
    // right away (the badge count is purely a local-storage "last seen"
    // timestamp, see boardSeenAt/markBoardSeen -- no server round trip
    // needed to clear it).
    const boardBtn = container.querySelector('#boardOpenBtn');
    const boardOverlay = container.querySelector('#boardOverlay');
    if (boardBtn && boardOverlay) {
      boardBtn.addEventListener('click', () => {
        boardModalOpen = true;
        boardOverlay.hidden = false;
        markBoardSeen(session);
        boardBtn.querySelector('.personal-badge')?.remove();
      });
      const closeBoardModal = () => {
        boardModalOpen = false;
        boardOverlay.hidden = true;
      };
      container.querySelector('#boardClose')?.addEventListener('click', closeBoardModal);
      boardOverlay.addEventListener('click', (e) => {
        if (e.target === boardOverlay) closeBoardModal();
      });
    }

    // "צידה לדרך + הכלים שלי" popup.
    const trailBtn = container.querySelector('#trailToolsOpenBtn');
    const trailOverlay = container.querySelector('#trailOverlay');
    if (trailBtn && trailOverlay) {
      trailBtn.addEventListener('click', () => {
        trailModalOpen = true;
        trailOverlay.hidden = false;
      });
      const closeTrailModal = () => {
        trailModalOpen = false;
        trailOverlay.hidden = true;
      };
      container.querySelector('#trailClose')?.addEventListener('click', closeTrailModal);
      trailOverlay.addEventListener('click', (e) => {
        if (e.target === trailOverlay) closeTrailModal();
      });
    }

    // "תיק אישי" free-writing -- the notebook page itself is the field;
    // save just appends the new entry and repaints locally, same pattern
    // every other student action on this page already uses.
    const notebookSaveBtn = container.querySelector('#notebookSaveBtn');
    if (notebookSaveBtn) {
      notebookSaveBtn.addEventListener('click', async () => {
        const input = container.querySelector('#notebookInput');
        const text = input.value.trim();
        if (!text) return;
        notebookSaveBtn.disabled = true;
        const created = await notebookStore.create({ studentId: session.id, text });
        notebookSaveBtn.disabled = false;
        if (created) render();
      });
    }
  }

  function wireMasterHandlers() {
    const form = container.querySelector('#focusComposeForm');
    const errorEl = container.querySelector('#focusSendError');
    const studentSelect = container.querySelector('#focusStudentSelect');
    const existingList = container.querySelector('#focusExistingList');
    // All real student ids currently in the dropdown -- used only for "no
    // student chosen" broadcasts, so a broadcast always reaches exactly
    // the same set the dropdown itself offers to pick from individually.
    const allStudentIds = Array.from(studentSelect.querySelectorAll('option'))
      .map((o) => o.value)
      .filter(Boolean);

    async function renderExistingForCurrentStudent() {
      const studentId = studentSelect.value;
      if (!studentId) {
        existingList.innerHTML = '';
        return;
      }
      const items = await focusStore.getForStudent(studentId);
      existingList.innerHTML = items.length
        ? `<p class="admin-focus-existing-title">מה שכבר נשלח:</p>${items.map((i) => focusItemHTML(i, { forAdmin: true })).join('')}`
        : '';
      wireAttachmentLinks(existingList);
    }

    studentSelect.addEventListener('change', renderExistingForCurrentStudent);
    renderExistingForCurrentStudent();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      errorEl.classList.remove('show');

      const title = container.querySelector('#focusTitleInput').value.trim();
      const text = container.querySelector('#focusTextInput').value.trim();
      const type = container.querySelector('#focusTypeSelect').value;
      const isImportant = container.querySelector('#focusImportantCheckbox').checked;
      const file = container.querySelector('#focusAttachmentInput').files[0] || null;
      const studentId = studentSelect.value;

      if (!text) {
        errorEl.textContent = 'יש להזין תוכן להודעה.';
        errorEl.classList.add('show');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      let ok;
      if (!studentId) {
        const created = await focusStore.createBroadcast({
          studentIds: allStudentIds,
          type,
          title,
          text,
          isImportant,
          createdBy: session.id,
          file,
        });
        ok = created.length > 0;
      } else {
        const created = await focusStore.create({ studentId, type, title, text, isImportant, createdBy: session.id, file });
        ok = !!created;
      }

      submitBtn.disabled = false;
      if (!ok) {
        errorEl.textContent = 'השליחה נכשלה, נסה שוב.';
        errorEl.classList.add('show');
        return;
      }

      await render();
    });

    // "מה נשלח לאחרונה" popup -- opens/closes locally, no reload.
    const recentBtn = container.querySelector('#recentSentOpenBtn');
    const recentOverlay = container.querySelector('#recentSentOverlay');
    if (recentBtn && recentOverlay) {
      recentBtn.addEventListener('click', () => {
        recentSentModalOpen = true;
        recentOverlay.hidden = false;
      });
      const closeRecentModal = () => {
        recentSentModalOpen = false;
        editingAnnouncementKey = null;
        recentOverlay.hidden = true;
      };
      container.querySelector('#recentSentClose')?.addEventListener('click', closeRecentModal);
      recentOverlay.addEventListener('click', (e) => {
        if (e.target === recentOverlay) closeRecentModal();
      });
    }
    wireRecentSentRowActions();

    wireDailyWheelManager(container, {
      sentences: wheelSentencesCache,
      rerender: render,
      getEditingId: () => editingWheelSentenceId,
      setEditingId: (v) => { editingWheelSentenceId = v; },
    });
    wireDailyWheelSentencesModal(container, {
      sentences: wheelSentencesCache,
      rerender: render,
      getEditingId: () => editingWheelSentenceId,
      setEditingId: (v) => { editingWheelSentenceId = v; },
      setOpen: (v) => { wheelSentencesModalOpen = v; },
    });

    // "התראות אבטחה" -- re-running the check refetches login_events fresh
    // (unlike the automatic once-on-load check above) and repaints via the
    // same full render() every other master action here already uses; the
    // strip/bubble itself just opens and closes locally.
    const runCheckBtn = container.querySelector('#runSecurityCheckBtn');
    if (runCheckBtn) {
      runCheckBtn.addEventListener('click', async () => {
        runCheckBtn.disabled = true;
        const [allUsers, events] = await Promise.all([usersStore.getAll(), loginEventsStore.getAll()]);
        const usersById = new Map(allUsers.map((u) => [u.id, u.fullName]));
        securityAlertsCache = computeSecurityAlerts(events, usersById);
        runCheckBtn.disabled = false;
        await render();
      });
    }
    const securityStripBtn = container.querySelector('#securityAlertsStripBtn');
    const securityOverlay = container.querySelector('#securityAlertsOverlay');
    if (securityStripBtn && securityOverlay) {
      securityStripBtn.addEventListener('click', () => {
        securityBubbleOpen = true;
        securityOverlay.hidden = false;
      });
      const closeSecurityModal = () => {
        securityBubbleOpen = false;
        securityOverlay.hidden = true;
      };
      container.querySelector('#securityAlertsClose')?.addEventListener('click', closeSecurityModal);
      securityOverlay.addEventListener('click', (e) => {
        if (e.target === securityOverlay) closeSecurityModal();
      });
    }
  }

  await render();
}
