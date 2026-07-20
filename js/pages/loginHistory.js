// "היסטוריית התחברויות" -- master-only. Same clean name-list -> popup
// pattern as studentFolders.js: plain buttons (no table, no horizontal
// scroll), clicking one opens a small modal with that student's own
// login_events rows (data/loginEventsStore.js), newest first. View only.

import { usersStore } from '../data/usersStore.js';
import { loginEventsStore } from '../data/loginEventsStore.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function studentButtonHTML(user) {
  return `<button type="button" class="student-folder-btn" data-id="${user.id}">${escapeHtml(user.fullName)}</button>`;
}

const DEVICE_ICON = { mobile: '📱', tablet: '📱', desktop: '💻' };

function formatEventTime(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  const timePart = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function eventRowHTML(e) {
  const icon = DEVICE_ICON[e.deviceType] || '🖥';
  const parts = [e.os, e.browser].filter(Boolean).join(' · ');
  return `
    <div class="login-event-row">
      <span class="login-event-icon" aria-hidden="true">${icon}</span>
      <div class="login-event-main">
        <span class="login-event-time">${formatEventTime(e.createdAt)}</span>
        <span class="login-event-meta">${escapeHtml(parts || 'לא ידוע')}${e.ip ? ` · IP: ${escapeHtml(e.ip)}` : ''}</span>
      </div>
    </div>`;
}

async function historyBodyHTML(user) {
  const events = await loginEventsStore.getForUser(user.id);
  if (!events.length) {
    return '<p class="placeholder-desc" style="margin:0;">אין עדיין תיעוד התחברויות עבור התלמיד/ה הזו (התיעוד פועל מרגע הפעלת הפיצ׳ר).</p>';
  }
  return `<div class="login-event-list">${events.map(eventRowHTML).join('')}</div>`;
}

export async function mountLoginHistory(container) {
  let students = [];
  let openStudentId = null;

  function render() {
    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">היסטוריית התחברויות</h1>
          <p class="placeholder-desc">בחר/י תלמיד/ה כדי לצפות בהיסטוריית ההתחברויות שלו/ה -- מכשיר, מערכת הפעלה, דפדפן ו-IP אם קיים.</p>
        </div>
        <div class="student-folder-list">${
          students.length ? students.map(studentButtonHTML).join('') : '<p class="placeholder-desc">אין עדיין תלמידים במערכת.</p>'
        }</div>
      </div>
      <div class="personal-modal-overlay" id="loginHistoryOverlay" hidden>
        <div class="personal-modal-card panel-card">
          <div class="personal-modal-header">
            <h3 class="personal-block-title" id="loginHistoryTitle">היסטוריית התחברויות</h3>
            <button type="button" class="personal-modal-close" id="loginHistoryClose" aria-label="סגירה">✕</button>
          </div>
          <div class="personal-modal-body" id="loginHistoryBody"></div>
        </div>
      </div>`;
    wire();
  }

  function wire() {
    const overlay = container.querySelector('#loginHistoryOverlay');
    const closeModal = () => {
      overlay.hidden = true;
      openStudentId = null;
    };
    container.querySelector('#loginHistoryClose')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    container.querySelectorAll('.student-folder-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const user = students.find((u) => u.id === id);
        if (!user) return;
        openStudentId = id;
        container.querySelector('#loginHistoryTitle').textContent = `היסטוריית התחברויות: ${user.fullName}`;
        const body = container.querySelector('#loginHistoryBody');
        overlay.hidden = false;
        // Opening a popup is never a "heavy" operation on its own (per the
        // loader's whitelist-only scope, see js/loader.js) -- this fetch
        // is small and typically instant either way.
        const html = await historyBodyHTML(user);
        if (openStudentId !== id) return;
        body.innerHTML = html;
      });
    });
  }

  students = (await usersStore.getAll()).filter((u) => u.role !== 'admin');
  render();
}
