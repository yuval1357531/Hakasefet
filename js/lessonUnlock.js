// נעילת שיעורים לפי רצף -- משותף לשיעורי "הכספת" ו"מהישרדות לחופש".
// כל שיעור מקבל (או לא) שדה "נפתח ברצף של N ימים" (lesson.unlockStreak).
// ריק = פתוח לכולם. הנעילה האמיתית נעשית בשרת (supabase-lesson-unlock.sql):
// שיעור נעול לא נמסר בכלל לתלמיד, והשרת רק מוסר שם + "עוד N ימים" כדי
// שיוצג מעומעם עם מנעול. כאן: משיכת הרשימה הנעולה, ציור הכפתור הנעול,
// החלון הקטן, ועריכת השדה אצל המאסטר.

import { supabase } from './supabaseClient.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function daysWord(n) {
  return n === 1 ? 'יום' : 'ימים';
}

// sectionId: 'vault' | 'survivalToFreedom'. Returns [] for the master, for
// a section with nothing locked, or if the SQL was not run yet.
export async function fetchLockedLessons(sectionId) {
  try {
    const { data, error } = await supabase.rpc('hk_locked_lessons');
    if (error || !Array.isArray(data)) return [];
    return data
      .filter((r) => r.section === sectionId)
      .map((r) => ({
        id: r.id,
        title: r.title,
        order: r.ord,
        unlockStreak: r.unlock_streak,
        daysLeft: r.days_left,
        isActive: true,
        locked: true,
      }));
  } catch (e) {
    return [];
  }
}

// Open lessons + locked stubs, in the lessons' own order.
export function mergeLockedLessons(open, locked) {
  if (!locked.length) return open;
  return [...open, ...locked].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// --- student: a dimmed, locked lesson row --------------------------------

export function lockedTabHTML(lesson) {
  const left = Math.max(1, lesson.daysLeft || 1);
  return `
    <button type="button" class="lesson-tab is-locked" data-locked-lesson="${escapeHtml(lesson.id)}">
      <span class="lesson-tab-check lesson-lock-icon" aria-hidden="true">🔒</span>
      <span class="lesson-tab-title">${escapeHtml(lesson.title)}</span>
      <span class="lesson-lock-note">עוד ${left} ${daysWord(left)}</span>
    </button>`;
}

// Tap on a locked lesson: a small popup that says what is missing and links
// to the streak map (which lives on the personal page, #/me).
export function wireLockedTabs(container, lessons) {
  container.querySelectorAll('[data-locked-lesson]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lesson = lessons.find((l) => l.id === btn.dataset.lockedLesson);
      if (!lesson) return;
      const left = Math.max(1, lesson.daysLeft || 1);
      const have = Math.max(0, (lesson.unlockStreak || 0) - left);
      container.querySelector('#lessonLockedOverlay')?.remove();
      container.insertAdjacentHTML(
        'beforeend',
        `
        <div class="desc-modal-overlay" id="lessonLockedOverlay" role="dialog" aria-modal="true">
          <div class="desc-modal-card panel-card">
            <p class="lesson-lock-modal-icon" aria-hidden="true">🔒</p>
            <p class="lesson-text"><strong>${escapeHtml(lesson.title)}</strong><br>
              נפתח ברצף של ${lesson.unlockStreak} ${daysWord(lesson.unlockStreak)}.<br>
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
    });
  });
}

// --- master: the lock button on a lesson row + its inline form ------------

export function unlockButtonHTML(lesson) {
  const set = lesson.unlockStreak > 0;
  return `<button type="button" class="lesson-row-unlock ${set ? 'is-set' : ''}" data-lesson-action="edit-unlock" data-lesson-id="${lesson.id}" title="נעילה לפי רצף">${set ? `🔒 ${lesson.unlockStreak}` : '🔓'}</button>`;
}

export function unlockFormRowHTML(lesson, reorderHTML) {
  return `
    <div class="lesson-row-manage ${!lesson.isActive ? 'lesson-row-inactive' : ''}">
      <div class="lesson-row-reorder">${reorderHTML}</div>
      <form class="lesson-row-unlock-form" data-lesson-id="${lesson.id}">
        <label class="lesson-unlock-label">נפתח ברצף של</label>
        <input type="number" inputmode="numeric" min="1" max="999" step="1" class="editable-input lesson-unlock-input" placeholder="ימים" value="${lesson.unlockStreak > 0 ? lesson.unlockStreak : ''}">
        <span class="lesson-unlock-hint">ימים · ריק = פתוח לכולם</span>
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
