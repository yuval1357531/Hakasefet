// Admin management for the "הכספת" section: a lesson list (add/edit/
// delete/reorder/toggle-active) and, per lesson, comment moderation
// (approve/hide/delete). Same local render()/wire() closure pattern as
// manageUsers.js / manageFreedomLessons.js.

import { vaultStore } from '../data/vaultStore.js';
import { commentsStore } from '../data/commentsStore.js';

function loadingHTML() {
  return '<div class="placeholder-page"><div class="placeholder-badge">טוען...</div></div>';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function mountManageVaultLessons(container) {
  let editingId = null;

  function lessonRow(lesson, pendingCount) {
    const hasVideo = lesson.embedUrl ? '<span class="badge badge-active">יש וידאו</span>' : '<span class="badge">אין וידאו</span>';
    const commentsLabel = pendingCount > 0 ? `תגובות (${pendingCount})` : 'תגובות';

    return `
      <tr data-id="${lesson.id}">
        <td>${escapeHtml(lesson.title)}</td>
        <td><span class="badge ${lesson.isActive ? 'badge-active' : 'badge-blocked'}">${lesson.isActive ? 'פעיל' : 'לא פעיל'}</span></td>
        <td>${hasVideo}</td>
        <td class="actions-cell">
          <button type="button" class="btn-ghost small" data-action="move-up" title="הזז למעלה">↑</button>
          <button type="button" class="btn-ghost small" data-action="move-down" title="הזז למטה">↓</button>
          <a class="btn-ghost small" href="#/admin/manage-vault/${lesson.id}">${commentsLabel}</a>
          <button type="button" class="btn-ghost small" data-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small" data-action="toggle-active">${lesson.isActive ? 'השבתה' : 'הפעלה'}</button>
          <button type="button" class="btn-ghost small danger" data-action="delete">מחיקה</button>
        </td>
      </tr>`;
  }

  async function render() {
    const lessons = await vaultStore.lessons.getAll();
    const editing = editingId ? await vaultStore.lessons.getById(editingId) : null;

    const rows = [];
    for (const lesson of lessons) {
      const comments = await commentsStore.getByLessonId(lesson.id);
      const pendingCount = comments.filter((c) => c.status === 'pending').length;
      rows.push(lessonRow(lesson, pendingCount));
    }

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">ניהול הכספת</h1>
          <p class="placeholder-desc">הוספה, עריכה, מחיקה, סידור והפעלה/כיבוי של שיעורי הסקשן.</p>
        </div>

        <div class="panel-card">
          <h2 class="form-title">${editing ? `עריכת שיעור: ${escapeHtml(editing.title)}` : 'הוספת שיעור חדש'}</h2>
          <form id="lessonForm" novalidate>
            <div class="field-group">
              <label for="lTitle">כותרת</label>
              <input type="text" id="lTitle" placeholder="כותרת השיעור" value="${editing ? escapeHtml(editing.title) : ''}">
            </div>
            <div class="field-group">
              <label for="lDescription">תיאור</label>
              <input type="text" id="lDescription" placeholder="תיאור קצר של השיעור" value="${editing ? escapeHtml(editing.description) : ''}">
            </div>
            <div class="field-group">
              <label for="lEmbedUrl">קישור Embed (Spotlightr)</label>
              <input type="text" id="lEmbedUrl" placeholder="https://..." value="${editing ? escapeHtml(editing.embedUrl) : ''}">
            </div>
            <div class="field-group">
              <label for="lStatus">סטטוס</label>
              <select id="lStatus">
                <option value="active" ${!editing || editing.isActive ? 'selected' : ''}>פעיל</option>
                <option value="inactive" ${editing && !editing.isActive ? 'selected' : ''}>לא פעיל</option>
              </select>
            </div>

            <div class="error-msg" id="lessonFormError" role="alert"></div>

            <div class="form-actions">
              <button type="submit" class="btn-gold">${editing ? 'שמירת שינויים' : 'הוספת שיעור'}</button>
              ${editing ? '<button type="button" class="btn-ghost" id="cancelEdit">ביטול</button>' : ''}
            </div>
          </form>
        </div>

        <div class="panel-card">
          <h2 class="form-title">שיעורים קיימים</h2>
          <div class="table-scroll">
            <table class="users-table">
              <thead><tr><th>כותרת</th><th>סטטוס</th><th>וידאו</th><th>פעולות</th></tr></thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    wire();
  }

  function wire() {
    const form = container.querySelector('#lessonForm');
    const errorEl = container.querySelector('#lessonFormError');
    const cancelBtn = container.querySelector('#cancelEdit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = container.querySelector('#lTitle').value.trim();
      const description = container.querySelector('#lDescription').value.trim();
      const embedUrl = container.querySelector('#lEmbedUrl').value.trim();
      const isActive = container.querySelector('#lStatus').value === 'active';

      if (!title) {
        errorEl.textContent = 'יש למלא כותרת לשיעור.';
        errorEl.classList.add('show');
        return;
      }

      if (editingId) {
        await vaultStore.lessons.update(editingId, { title, description, embedUrl, isActive });
      } else {
        await vaultStore.lessons.create({ title, description, embedUrl, isActive });
      }

      editingId = null;
      await render();
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        editingId = null;
        await render();
      });
    }

    container.querySelectorAll('.users-table [data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const action = btn.dataset.action;

        if (action === 'edit') {
          editingId = id;
          await render();
        } else if (action === 'delete') {
          if (window.confirm('למחוק את השיעור? כל התגובות המשויכות אליו יימחקו גם הן.')) {
            await vaultStore.lessons.remove(id);
            await commentsStore.removeByLessonId(id);
            if (editingId === id) editingId = null;
            await render();
          }
        } else if (action === 'toggle-active') {
          const lesson = await vaultStore.lessons.getById(id);
          await vaultStore.lessons.update(id, { isActive: !lesson.isActive });
          await render();
        } else if (action === 'move-up') {
          await vaultStore.lessons.moveUp(id);
          await render();
        } else if (action === 'move-down') {
          await vaultStore.lessons.moveDown(id);
          await render();
        }
      });
    });
  }

  container.innerHTML = loadingHTML();
  await render();
}

const STATUS_LABELS = { pending: 'ממתין', approved: 'מאושר', hidden: 'מוסתר' };
const STATUS_BADGE = { pending: '', approved: 'badge-active', hidden: 'badge-blocked' };

export async function mountManageVaultComments(container, lessonId) {
  container.innerHTML = loadingHTML();
  const lesson = await vaultStore.lessons.getById(lessonId);

  if (!lesson) {
    container.innerHTML = `
      <div class="placeholder-page">
        <h1 class="gold-title placeholder-title">השיעור לא נמצא</h1>
        <a href="#/admin/manage-vault" class="btn-gold placeholder-back">חזרה לרשימת השיעורים</a>
      </div>`;
    return;
  }

  function commentRow(comment) {
    return `
      <tr data-id="${comment.id}">
        <td>${escapeHtml(comment.displayName)}</td>
        <td>${escapeHtml(comment.text)}</td>
        <td><span class="badge ${STATUS_BADGE[comment.status]}">${STATUS_LABELS[comment.status]}</span></td>
        <td class="actions-cell">
          ${comment.status !== 'approved' ? '<button type="button" class="btn-ghost small" data-action="approve">אישור</button>' : ''}
          ${comment.status !== 'hidden' ? '<button type="button" class="btn-ghost small" data-action="hide">הסתרה</button>' : ''}
          <button type="button" class="btn-ghost small danger" data-action="delete">מחיקה</button>
        </td>
      </tr>`;
  }

  async function render() {
    const comments = await commentsStore.getByLessonId(lessonId);

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <a href="#/admin/manage-vault" class="btn-ghost small back-link">חזרה לרשימת השיעורים</a>
          <h1 class="gold-title placeholder-title">תגובות עבור: ${escapeHtml(lesson.title)}</h1>
          <p class="placeholder-desc">אישור, הסתרה או מחיקה של תגובות שנשלחו לשיעור זה.</p>
        </div>

        <div class="panel-card">
          <div class="table-scroll">
            <table class="users-table">
              <thead><tr><th>משתמש</th><th>תגובה</th><th>סטטוס</th><th>פעולות</th></tr></thead>
              <tbody>${comments.map(commentRow).join('') || '<tr><td colspan="4">אין עדיין תגובות לשיעור זה.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    container.querySelectorAll('.users-table [data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const action = btn.dataset.action;

        if (action === 'approve') {
          await commentsStore.approve(id);
          await render();
        } else if (action === 'hide') {
          await commentsStore.hide(id);
          await render();
        } else if (action === 'delete') {
          if (window.confirm('למחוק את התגובה?')) {
            await commentsStore.remove(id);
            await render();
          }
        }
      });
    });
  }

  await render();
}
