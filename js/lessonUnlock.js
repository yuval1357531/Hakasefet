// שיעורים קפואים בקרח -- משותף לשיעורי "הכספת" ו"מהישרדות לחופש".
// המאסטר קובע לכל שיעור "נפתח ברצף של N ימים" (lesson.unlockStreak, ריק =
// פתוח לכולם). לתלמיד השיעור נשאר ברשימה כקרח עם המספר עליו; כשהרצף הטוב
// ביותר שלו מגיע ל-N הקרח "מוכן להמסה" והוא ממיס אותו בלחיצה (ואז השיעור
// פתוח לו לתמיד). הנעילה האמיתית בשרת (supabase-lesson-unlock.sql): שיעור
// קפוא לא נמסר בכלל, והשרת רק מוסר שם + יעד + כמה ימים נשארו.
// כאן: משיכת הרשימה, ציור הקרח, ההמסה, החלון הקטן, יעדי המפה ועריכת השדה.

import { supabase } from './supabaseClient.js';
import { vaultStore } from './data/vaultStore.js';
import { freedomStore } from './data/freedomStore.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function daysWord(n) {
  return n === 1 ? 'יום' : 'ימים';
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function toStub(r) {
  return {
    section: r.section,
    id: r.id,
    title: r.title,
    order: r.ord,
    unlockStreak: r.unlock_streak,
    daysLeft: r.days_left,
    ready: !!r.ready,
    isActive: true,
    locked: true,
  };
}

// Every frozen (not yet melted) lesson of this student, all sections. [] for
// the master, or if the SQL was not run yet.
export async function fetchAllLockedLessons() {
  try {
    const { data, error } = await supabase.rpc('hk_locked_lessons');
    if (error || !Array.isArray(data)) return [];
    return data.map(toStub);
  } catch (e) {
    return [];
  }
}

// sectionId: 'vault' | 'survivalToFreedom'
export async function fetchLockedLessons(sectionId) {
  return (await fetchAllLockedLessons()).filter((l) => l.section === sectionId);
}

// Open lessons + frozen stubs, in the lessons' own order.
export function mergeLockedLessons(open, locked) {
  if (!locked.length) return open;
  return [...open, ...locked].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Melts one lesson on the server (only succeeds if the best streak reached it).
export async function meltLesson(sectionId, lessonId) {
  try {
    const { data, error } = await supabase.rpc('hk_melt_lesson', { p_section: sectionId, p_id: lessonId });
    return !error && data === true;
  } catch (e) {
    return false;
  }
}

// --- the map: one goal per distinct number, listing the frozen lessons ------

// [{ days, lessons: [{ section, id, title }] }] sorted by days. Students get
// their own frozen lessons from the server; the master's preview shows every
// lesson that carries a number.
export async function fetchIceGoals(isDemo) {
  let flat;
  if (isDemo) {
    const [v, f] = await Promise.all([vaultStore.lessons.getActive(), freedomStore.lessons.getActive()]);
    flat = [
      ...v.filter((l) => l.unlockStreak > 0).map((l) => ({ section: 'vault', id: l.id, title: l.title, unlockStreak: l.unlockStreak })),
      ...f.filter((l) => l.unlockStreak > 0).map((l) => ({ section: 'survivalToFreedom', id: l.id, title: l.title, unlockStreak: l.unlockStreak })),
    ];
  } else {
    flat = await fetchAllLockedLessons();
  }
  const byDays = new Map();
  flat.forEach((l) => {
    if (!byDays.has(l.unlockStreak)) byDays.set(l.unlockStreak, []);
    byDays.get(l.unlockStreak).push({ section: l.section, id: l.id, title: l.title });
  });
  return [...byDays.entries()].sort((a, b) => a[0] - b[0]).map(([days, lessons]) => ({ days, lessons }));
}

// --- student: a frozen lesson row -----------------------------------------

// The ice itself is a real rendered clip (tools/flame/ice.html): a block of
// glacier ice with a light sweep and twinkling glints, same craft as the fire.
const ICE_BASE = 'assets/ice/ice';

// Videos inserted through innerHTML don't always start on their own.
function wakeIce(root) {
  const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('.ice-video').forEach((v) => {
    v.muted = true;
    if (still) {
      v.removeAttribute('autoplay');
      return;
    }
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  });
}

export function lockedTabHTML(lesson) {
  const left = Math.max(0, lesson.daysLeft || 0);
  const note = lesson.ready ? 'מוכן להמסה ◂' : `עוד ${left} ${daysWord(left)}`;
  return `
    <button type="button" class="lesson-tab is-locked is-ice${lesson.ready ? ' is-ready' : ''}" data-locked-lesson="${escapeHtml(lesson.id)}">
      <video class="ice-video" aria-hidden="true" src="${ICE_BASE}${lesson.ready ? '-warm' : ''}.mp4" poster="${ICE_BASE}${lesson.ready ? '-warm' : ''}.webp" autoplay loop muted playsinline preload="metadata"></video>
      <span class="ice-num" aria-hidden="true">${lesson.unlockStreak}</span>
      <span class="lesson-tab-title">${escapeHtml(lesson.title)}</span>
      <span class="lesson-lock-note">${note}</span>
      <span class="ice-glaze" aria-hidden="true"></span>
      <span class="ice-drips" aria-hidden="true"></span>
    </button>`;
}

function showLockedModal(container, lesson) {
  const left = Math.max(1, lesson.daysLeft || 1);
  const have = Math.max(0, (lesson.unlockStreak || 0) - left);
  container.querySelector('#lessonLockedOverlay')?.remove();
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="desc-modal-overlay" id="lessonLockedOverlay" role="dialog" aria-modal="true">
      <div class="desc-modal-card panel-card">
        <p class="lesson-lock-modal-icon" aria-hidden="true">❄</p>
        <p class="lesson-text"><strong>${escapeHtml(lesson.title)}</strong><br>
          קפוא בקרח. נמס ברצף של ${lesson.unlockStreak} ${daysWord(lesson.unlockStreak)}.<br>
          הרצף הטוב ביותר שלך: ${have}. נשארו עוד ${left} ${daysWord(left)}.</p>
        <div class="lesson-lock-modal-actions">
          <a class="btn-gold" href="#/me">למפת הרצף</a>
          <button type="button" class="btn-ghost small" id="lessonLockedClose">סגירה</button>
        </div>
      </div>
    </div>`
  );
  const overlay = container.querySelector('#lessonLockedOverlay');
  const close = () => overlay.remove();
  overlay.querySelector('#lessonLockedClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

// Tap on a frozen lesson: if the streak reached it, the ice melts (animation,
// then the real lesson takes its place); otherwise a small popup says what is
// missing. sectionId/store: the section's own ids and lessons store;
// onMelted(fullLesson) lets the page swap the stub for the real lesson.
export function wireLockedTabs(container, lessons, { sectionId, store, onMelted }) {
  wakeIce(container);
  container.querySelectorAll('[data-locked-lesson]').forEach((btn) => {
    let busy = false;
    btn.addEventListener('click', async () => {
      const lesson = lessons.find((l) => l.id === btn.dataset.lockedLesson);
      if (!lesson) return;
      if (!lesson.ready) {
        showLockedModal(container, lesson);
        return;
      }
      if (busy) return;
      busy = true;
      btn.classList.add('is-melting');
      const [ok] = await Promise.all([meltLesson(sectionId, lesson.id), wait(1300)]);
      if (!ok) {
        busy = false;
        btn.classList.remove('is-melting');
        window.alert('ההמסה לא הצליחה. נסה שוב בעוד רגע.');
        return;
      }
      const full = await store.lessons.getById(lesson.id);
      if (full) onMelted(full);
    });
  });
}

// --- master: the lock button on a lesson row + its inline form ------------

export function unlockButtonHTML(lesson) {
  const set = lesson.unlockStreak > 0;
  return `<button type="button" class="lesson-row-unlock ${set ? 'is-set' : ''}" data-lesson-action="edit-unlock" data-lesson-id="${lesson.id}" title="קרח: נפתח ברצף של N ימים">${set ? `❄ ${lesson.unlockStreak}` : '🔓'}</button>`;
}

export function unlockFormRowHTML(lesson, reorderHTML) {
  return `
    <div class="lesson-row-manage ${!lesson.isActive ? 'lesson-row-inactive' : ''}">
      <div class="lesson-row-reorder">${reorderHTML}</div>
      <form class="lesson-row-unlock-form" data-lesson-id="${lesson.id}">
        <label class="lesson-unlock-label">❄ נמס ברצף של</label>
        <input type="number" inputmode="numeric" min="1" max="999" step="1" class="editable-input lesson-unlock-input" placeholder="ימים" value="${lesson.unlockStreak > 0 ? lesson.unlockStreak : ''}">
        <span class="lesson-unlock-hint">ימים · ריק = פתוח לכולם · המספר מופיע גם במפת הרצף</span>
        <button type="submit" class="edit-save" title="שמירה">✓</button>
        <button type="button" class="edit-cancel" data-cancel-unlock-edit title="ביטול">✕</button>
      </form>
    </div>`;
}

// store: vaultStore / freedomStore. lessons: the page's local array
// (patched in place). setEditing(null) closes the form; rerender repaints.
export function wireUnlockForms(container, { store, lessons, setEditing, rerender }) {
  container.querySelectorAll('.lesson-row-unlock-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = form.dataset.lessonId;
      const raw = form.querySelector('.lesson-unlock-input').value.trim();
      const n = raw === '' ? null : Math.floor(Number(raw));
      if (raw !== '' && !(n >= 1)) return;
      const updated = await store.lessons.update(id, { unlockStreak: n });
      if (!updated) {
        window.alert('השמירה נכשלה. אם זו הפעם הראשונה, יש להריץ פעם אחת את הקובץ supabase-lesson-unlock.sql ב-Supabase.');
        return;
      }
      const idx = lessons.findIndex((l) => l.id === id);
      if (idx !== -1) lessons[idx] = updated;
      setEditing(null);
      rerender();
    });
  });
  container.querySelectorAll('[data-cancel-unlock-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setEditing(null);
      rerender();
    });
  });
}
