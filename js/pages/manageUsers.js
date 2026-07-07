// Interactive "manage users" admin page: create/edit/delete/block users
// and assign per-section access. Talks only to usersStore -- account
// creation/deletion route through the master-only serverless functions
// internally, permission/status edits go through a normal RLS-gated
// update, but this page doesn't need to know which is which.

import { usersStore } from '../data/usersStore.js';
import { SECTIONS } from '../sections.config.js';

const CREATE_ERROR_MESSAGES = {
  email_taken: 'האימייל הזה כבר רשום במערכת.',
  invalid_input: 'יש למלא את כל השדות הנדרשים.',
  unauthorized: 'אין הרשאה לבצע פעולה זו.',
  server_error: 'שגיאה בשרת. נסה שוב.',
};

export function mountManageUsers(container) {
  let editingId = null;

  function sectionCheckboxes(permissions) {
    return SECTIONS.map(
      (s) => `
      <label class="checkbox-pill">
        <input type="checkbox" name="sections" value="${s.id}" ${permissions[s.id] ? 'checked' : ''}>
        <span>${s.label}</span>
      </label>`
    ).join('');
  }

  function userRow(user) {
    // Only one account can ever have role==='admin' (there is no UI path
    // to grant it) -- protect that row from self-edit/self-delete exactly
    // like the old hardcoded id==='master' guard used to.
    const isMaster = user.role === 'admin';
    const sectionsLabel =
      SECTIONS.filter((s) => user.permissions[s.id]).map((s) => s.label).join(', ') || '—';

    return `
      <tr data-id="${user.id}">
        <td>${user.fullName}</td>
        <td dir="ltr">${user.username}</td>
        <td><span class="badge ${user.role === 'admin' ? 'badge-gold' : ''}">${user.role === 'admin' ? 'מאסטר המערכת' : 'משתמש'}</span></td>
        <td><span class="badge ${user.status === 'active' ? 'badge-active' : 'badge-blocked'}">${user.status === 'active' ? 'פעיל' : 'לא פעיל'}</span></td>
        <td class="sections-cell">${sectionsLabel}</td>
        <td class="actions-cell">
          ${
            isMaster
              ? '<span class="muted-note">מאסטר קבוע</span>'
              : `
            <button type="button" class="btn-ghost small" data-action="edit">עריכה</button>
            <button type="button" class="btn-ghost small" data-action="toggle-status">${user.status === 'active' ? 'חסימה' : 'פתיחה'}</button>
            <button type="button" class="btn-ghost small danger" data-action="delete">מחיקה</button>
          `
          }
        </td>
      </tr>`;
  }

  async function render() {
    const users = await usersStore.getAll();
    const editingUser = editingId ? await usersStore.getById(editingId) : null;

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">ניהול משתמשים</h1>
          <p class="placeholder-desc">יצירה, עריכה, חסימה ומחיקה של משתמשי המערכת, וקביעת הרשאות גישה לסקשנים.</p>
        </div>

        <div class="panel-card">
          <h2 class="form-title">${editingUser ? `עריכת משתמש: ${editingUser.username}` : 'יצירת משתמש חדש'}</h2>
          <form id="userForm" novalidate>
            <div class="form-grid">
              <div class="field-group">
                <label for="fullName">שם מלא</label>
                <input type="text" id="fullName" placeholder="לדוגמה: ישראל ישראלי" value="${editingUser ? editingUser.fullName : ''}">
              </div>
              <div class="field-group">
                <label for="uUsername">אימייל</label>
                <input type="email" id="uUsername" placeholder="student@example.com" dir="ltr" value="${editingUser ? editingUser.username : ''}" ${editingUser ? 'disabled' : ''}>
              </div>
              <div class="field-group">
                <label for="uPassword">סיסמה</label>
                <input type="text" id="uPassword" placeholder="${editingUser ? 'לא ניתן לשנות כאן' : 'סיסמה למשתמש'}" dir="ltr" ${editingUser ? 'disabled' : ''}>
              </div>
              <div class="field-group">
                <label for="uStatus">סטטוס</label>
                <select id="uStatus">
                  <option value="active" ${!editingUser || editingUser.status === 'active' ? 'selected' : ''}>פעיל</option>
                  <option value="blocked" ${editingUser && editingUser.status === 'blocked' ? 'selected' : ''}>לא פעיל</option>
                </select>
              </div>
            </div>

            <div class="field-group">
              <label>הרשאות גישה לסקשנים</label>
              <div class="checkbox-row">${sectionCheckboxes(editingUser ? editingUser.permissions : {})}</div>
            </div>

            <div class="error-msg" id="userFormError" role="alert"></div>

            <div class="form-actions">
              <button type="submit" class="btn-gold">${editingUser ? 'שמירת שינויים' : 'יצירת משתמש'}</button>
              ${editingUser ? '<button type="button" class="btn-ghost" id="cancelEdit">ביטול</button>' : ''}
            </div>
          </form>
        </div>

        <div class="panel-card">
          <h2 class="form-title">משתמשים קיימים</h2>
          <div class="table-scroll">
            <table class="users-table">
              <thead>
                <tr><th>שם מלא</th><th>אימייל</th><th>תפקיד</th><th>סטטוס</th><th>הרשאות</th><th>פעולות</th></tr>
              </thead>
              <tbody>${users.map(userRow).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    wire();
  }

  function wire() {
    const form = container.querySelector('#userForm');
    const errorEl = container.querySelector('#userFormError');
    const cancelBtn = container.querySelector('#cancelEdit');

    function showError(text) {
      errorEl.textContent = text;
      errorEl.classList.add('show');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fullName = container.querySelector('#fullName').value.trim();
      const username = container.querySelector('#uUsername').value.trim();
      const password = container.querySelector('#uPassword').value;
      const status = container.querySelector('#uStatus').value;
      const checkedIds = Array.from(container.querySelectorAll('input[name="sections"]:checked')).map((el) => el.value);
      const permissions = SECTIONS.reduce((acc, s) => {
        acc[s.id] = checkedIds.includes(s.id);
        return acc;
      }, {});

      if (!fullName || !username || (!editingId && !password)) {
        showError('יש למלא שם מלא, אימייל וסיסמה.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      if (editingId) {
        await usersStore.update(editingId, { fullName, status, permissions });
      } else {
        if (await usersStore.isUsernameTaken(username, null)) {
          submitBtn.disabled = false;
          showError('האימייל הזה כבר רשום במערכת.');
          return;
        }
        const result = await usersStore.create({ fullName, username, password, status, permissions });
        if (!result || result.error) {
          submitBtn.disabled = false;
          showError(CREATE_ERROR_MESSAGES[result?.error] || 'שגיאה ביצירת המשתמש.');
          return;
        }
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
          if (window.confirm('למחוק את המשתמש? הפעולה בלתי הפיכה.')) {
            await usersStore.remove(id);
            if (editingId === id) editingId = null;
            await render();
          }
        } else if (action === 'toggle-status') {
          const user = await usersStore.getById(id);
          await usersStore.update(id, { status: user.status === 'active' ? 'blocked' : 'active' });
          await render();
        }
      });
    });
  }

  render();
}
