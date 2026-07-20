// Interactive "manage users" admin page: create/edit/delete/block users
// and assign per-section access. Talks only to usersStore -- account
// creation/deletion route through the master-only serverless functions
// internally, permission/status edits go through a normal RLS-gated
// update, but this page doesn't need to know which is which.
//
// "יצירת משתמש חדש" is CREATE-ONLY (never repurposed for editing an
// existing user -- see the closing note on point 12 of the request this
// shape came from). "משתמשים קיימים" is a separate accordion holding a
// clean name-only button list (no table, no big cards); clicking a name
// opens a bubble/modal with that one user's actions + details + section
// permissions, mirroring the same personal-modal-overlay shell every
// other popup in this app already uses (studentFolders.js, personalArea.js).

import { usersStore } from '../data/usersStore.js';
import { SECTIONS } from '../sections.config.js';
import { accordionHTML, wireAccordions } from '../adminAccordion.js';

const CREATE_ERROR_MESSAGES = {
  email_taken: 'האימייל הזה כבר רשום במערכת.',
  invalid_input: 'יש למלא את כל השדות הנדרשים.',
  unauthorized: 'אין הרשאה לבצע פעולה זו.',
  server_error: 'שגיאה בשרת. נסה שוב.',
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

// DD/MM/YYYY, the same shape formatEventTime already uses below -- kept
// separate since this one takes a plain 'YYYY-MM-DD' date string (no
// time-of-day) rather than a full ISO timestamp.
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function isExpired(dateStr) {
  if (!dateStr) return false;
  return dateStr < new Date().toISOString().slice(0, 10);
}

// Formats as DD/MM/YYYY HH:MM -- simple/unambiguous for a Hebrew-RTL admin
// screen (used by the password-reset events panel below).
function formatEventTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resetEventRow(ev) {
  return `
    <tr>
      <td>${ev.fullName}</td>
      <td dir="ltr">${ev.email}</td>
      <td>${formatEventTime(ev.createdAt)}</td>
      <td><span class="badge badge-active">בוצע איפוס סיסמה</span></td>
    </tr>`;
}

export async function mountManageUsers(container) {
  const openAccordions = new Set();
  let users = [];
  // Client-side only -- filters the already-fetched `users` array by name
  // or email. Persisted across re-renders (module-level, not re-read from
  // the DOM) so creating/editing a user doesn't silently clear it.
  let searchQuery = '';
  // Which user's bubble is currently open, and whether that bubble is
  // showing the inline "עריכה" (name/status) form instead of the plain
  // read-only detail view -- both reset whenever the bubble is closed.
  let openUserId = null;
  let bubbleEditing = false;
  // A freshly-generated temporary password, shown ONCE right after
  // "יצירת סיסמה זמנית" so the master can copy it for the student --
  // never persisted anywhere, never re-shown once the bubble closes or a
  // different user opens (see resetPasswordState below).
  let generatedPassword = null;

  function resetPasswordState() {
    generatedPassword = null;
  }

  // Auth passwords live in Supabase Auth (hashed) -- there is no way to
  // read a student's CURRENT password, by design, so the only safe master
  // action is generating a fresh one. Excludes ambiguous characters
  // (0/O, 1/l/I) so it's easy to read aloud/retype without mistakes.
  function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function sectionCheckboxes(permissions, { name = 'sections' } = {}) {
    return SECTIONS.map(
      (s) => `
      <label class="checkbox-pill">
        <input type="checkbox" name="${name}" value="${s.id}" ${permissions[s.id] ? 'checked' : ''}>
        <span>${s.label}</span>
      </label>`
    ).join('');
  }

  // --- "יצירת משתמש חדש" -- always a blank create form, never pre-filled
  // for an existing user. ---------------------------------------------

  function createFormHTML() {
    return `
      <form id="userForm" novalidate>
        <div class="form-grid">
          <div class="field-group">
            <label for="fullName">שם מלא</label>
            <input type="text" id="fullName" placeholder="לדוגמה: ישראל ישראלי">
          </div>
          <div class="field-group">
            <label for="uUsername">אימייל</label>
            <input type="email" id="uUsername" placeholder="student@example.com" dir="ltr">
          </div>
          <div class="field-group">
            <label for="uPassword">סיסמה</label>
            <input type="text" id="uPassword" placeholder="סיסמה למשתמש" dir="ltr">
          </div>
          <div class="field-group">
            <label for="uStatus">סטטוס</label>
            <select id="uStatus">
              <option value="active" selected>פעיל</option>
              <option value="blocked">לא פעיל</option>
            </select>
          </div>
          <div class="field-group">
            <label for="uExpiry">תאריך סיום גישה (לא חובה)</label>
            <input type="date" id="uExpiry">
          </div>
        </div>

        <div class="field-group">
          <label>הרשאות גישה לסקשנים</label>
          <div class="checkbox-row">${sectionCheckboxes({})}</div>
        </div>

        <div class="error-msg" id="userFormError" role="alert"></div>

        <div class="form-actions">
          <button type="submit" class="btn-gold">יצירת משתמש</button>
        </div>
      </form>`;
  }

  // --- "משתמשים קיימים" -- plain name buttons, never a table/card grid. -

  function userButtonHTML(user) {
    const masterTag = user.role === 'admin' ? ' <span class="muted-note">(מאסטר)</span>' : '';
    return `<button type="button" class="student-folder-btn" data-id="${user.id}">${escapeHtml(user.fullName)}${masterTag}</button>`;
  }

  // Plain substring match on name/email, case-insensitive -- no query to
  // the server, just filtering the array render() already fetched.
  function filteredUsers() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.fullName.toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)
    );
  }

  function userListHTML() {
    if (!users.length) return '<p class="placeholder-desc">אין עדיין משתמשים במערכת.</p>';
    const list = filteredUsers();
    if (!list.length) return '<p class="placeholder-desc">לא נמצאו משתמשים.</p>';
    return `<div class="student-folder-list">${list.map(userButtonHTML).join('')}</div>`;
  }

  // Wires the name buttons currently in the DOM -- called after the full
  // render() and again after every search-driven list repaint, since the
  // set of rendered buttons changes with the filter.
  function wireUserButtons() {
    container.querySelectorAll('.student-folder-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        openUserId = btn.dataset.id;
        bubbleEditing = false;
        resetPasswordState();
        container.querySelector('#userBubbleOverlay').hidden = false;
        await repaintBubble();
      });
    });
  }

  // --- the user bubble itself: grouped actions on top (visually distinct
  // by kind -- neutral/edit, toggle, utility, danger), details below,
  // section permissions at the bottom, auto-saving on every change. ------

  function userDetailsHTML(user) {
    const rows = [
      ['שם', escapeHtml(user.fullName)],
      ['אימייל', `<span dir="ltr">${escapeHtml(user.username)}</span>`],
      ['תפקיד', user.role === 'admin' ? 'מאסטר המערכת' : 'משתמש'],
      ['סטטוס', user.status === 'active' ? 'פעיל' : 'לא פעיל'],
    ];
    if (user.accessExpiryDate) {
      const expired = isExpired(user.accessExpiryDate);
      rows.push(['גישה עד', `${formatDate(user.accessExpiryDate)}${expired ? ' (פג תוקף)' : ''}`]);
    }
    return `<div class="user-bubble-details">${rows
      .map(([label, value]) => `<div class="user-bubble-detail-row"><span class="muted-note">${label}</span><span>${value}</span></div>`)
      .join('')}</div>`;
  }

  function userEditFormHTML(user) {
    return `
      <form id="userEditForm" class="user-bubble-edit-form" novalidate>
        <div class="field-group">
          <label for="userEditName">שם מלא</label>
          <input type="text" id="userEditName" value="${escapeAttr(user.fullName)}">
        </div>
        <div class="field-group">
          <label for="userEditStatus">סטטוס</label>
          <select id="userEditStatus">
            <option value="active" ${user.status === 'active' ? 'selected' : ''}>פעיל</option>
            <option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>לא פעיל</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-gold small">שמירה</button>
          <button type="button" class="btn-ghost small" id="userEditCancel">ביטול</button>
        </div>
      </form>`;
  }

  // Auth passwords are hashed in Supabase Auth -- there is no "current
  // password" to reveal, so the only safe, clear action here is
  // generating a fresh temporary one. Shown ONCE, right after creation
  // (generatedPassword, reset the moment the bubble closes or a different
  // user opens -- see resetPasswordState), never logged or persisted.
  function passwordBlockHTML(user) {
    const revealHTML = generatedPassword
      ? `
      <div class="user-bubble-password-reveal">
        <span class="user-bubble-password-value" dir="ltr">${escapeHtml(generatedPassword)}</span>
        <button type="button" class="btn-ghost small" id="copyGeneratedPwBtn">העתקה</button>
      </div>
      <p class="muted-note user-bubble-password-hint">הסיסמה מוצגת כעת בלבד -- יש להעתיק ולמסור אותה לתלמיד/ה. היא לא תישמר ולא תוצג שוב.</p>`
      : '';
    return `
      <div class="user-bubble-password-block">
        <span class="muted-note">סיסמה נוכחית</span>
        <p class="muted-note" style="margin:0;">הסיסמה הנוכחית לא זמינה להצגה -- ניתן לאפס סיסמה</p>
        <button type="button" class="btn-ghost small" data-user-action="reset-password">איפוס סיסמה / צור סיסמה זמנית</button>
        ${revealHTML}
      </div>`;
  }

  function userBubbleBodyHTML(user) {
    if (user.role === 'admin') {
      return `${userDetailsHTML(user)}<p class="muted-note" style="margin-top:10px;">מאסטר קבוע -- ללא פעולות ניהול.</p>`;
    }
    // Grouped, visually distinct actions -- edit/neutral, a toggle, and
    // delete kept clearly apart (danger colour) so it's never mistaken for
    // the others. Password/login is its own clearly-labelled block below,
    // not lost among these.
    const actionsHTML = `
      <div class="user-bubble-actions">
        <button type="button" class="btn-ghost small" data-user-action="edit">עריכה</button>
        <button type="button" class="btn-ghost small" data-user-action="toggle-status">${user.status === 'active' ? 'חסימה' : 'שחרור חסימה'}</button>
        <button type="button" class="btn-ghost small danger" data-user-action="delete">מחיקה</button>
      </div>
      <div class="user-bubble-expiry">
        <label for="userBubbleExpiry">תאריך סיום גישה</label>
        <input type="date" id="userBubbleExpiry" value="${user.accessExpiryDate || ''}">
      </div>
      ${passwordBlockHTML(user)}`;
    const mainHTML = bubbleEditing ? userEditFormHTML(user) : userDetailsHTML(user);
    const permissionsHTML = `
      <div class="user-bubble-permissions">
        <label>הרשאות גישה לסקשנים</label>
        <div class="checkbox-row" id="userBubblePermissions">${sectionCheckboxes(user.permissions, { name: 'userBubbleSection' })}</div>
      </div>`;
    return `${actionsHTML}${mainHTML}${permissionsHTML}`;
  }

  async function render() {
    users = await usersStore.getAll();
    const resetEvents = await usersStore.getPasswordResetEvents();
    const openUser = openUserId ? users.find((u) => u.id === openUserId) : null;

    const formAccordion = accordionHTML('create-user', 'יצירת משתמש חדש', createFormHTML(), {
      isOpen: openAccordions.has('create-user'),
      titleClass: 'form-title',
    });
    const existingAccordion = accordionHTML(
      'existing-users',
      'משתמשים קיימים',
      `<div class="field-group" style="margin-bottom:14px;">
        <input type="search" id="userSearchInput" placeholder="חיפוש לפי שם או אימייל..." value="${escapeAttr(searchQuery)}" ${users.length ? '' : 'disabled'}>
      </div>
      <div id="userListWrap">${userListHTML()}</div>`,
      { isOpen: openAccordions.has('existing-users'), titleClass: 'form-title' }
    );

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">ניהול משתמשים</h1>
          <p class="placeholder-desc">יצירה, עריכה, חסימה ומחיקה של משתמשי המערכת, וקביעת הרשאות גישה לסקשנים.</p>
        </div>

        ${formAccordion}
        ${existingAccordion}

        <div class="personal-modal-overlay" id="userBubbleOverlay" ${openUser ? '' : 'hidden'}>
          <div class="personal-modal-card panel-card">
            <div class="personal-modal-header">
              <h3 class="personal-block-title" id="userBubbleTitle">${openUser ? escapeHtml(openUser.fullName) : ''}</h3>
              <button type="button" class="personal-modal-close" id="userBubbleClose" aria-label="סגירה">✕</button>
            </div>
            <div class="personal-modal-body" id="userBubbleBody">${openUser ? userBubbleBodyHTML(openUser) : ''}</div>
          </div>
        </div>

        ${resetEvents.length ? `
        <div class="panel-card">
          <h2 class="form-title">התראות איפוס סיסמה</h2>
          <div class="table-scroll">
            <table class="users-table">
              <thead>
                <tr><th>שם מלא</th><th>אימייל</th><th>תאריך ושעה</th><th>סטטוס</th></tr>
              </thead>
              <tbody>${resetEvents.map(resetEventRow).join('')}</tbody>
            </table>
          </div>
        </div>` : ''}
      </div>`;

    wire();
  }

  // Repaints ONLY the bubble body (+ its title, + that one name-button's
  // label in case the name changed) from a freshly-refetched user row --
  // used after every bubble action so the rest of the page (accordion
  // open/closed state, the reset-events panel) is never touched, no reload.
  async function repaintBubble() {
    if (!openUserId) return;
    const id = openUserId;
    const user = await usersStore.getById(id);
    if (openUserId !== id) return;
    if (!user) {
      openUserId = null;
      bubbleEditing = false;
      const overlay = container.querySelector('#userBubbleOverlay');
      if (overlay) overlay.hidden = true;
      return;
    }
    const idx = users.findIndex((u) => u.id === id);
    if (idx !== -1) users[idx] = user;
    const title = container.querySelector('#userBubbleTitle');
    const body = container.querySelector('#userBubbleBody');
    if (title) title.textContent = user.fullName;
    if (body) body.innerHTML = userBubbleBodyHTML(user);
    const nameBtn = container.querySelector(`.student-folder-btn[data-id="${id}"]`);
    if (nameBtn) nameBtn.textContent = user.fullName + (user.role === 'admin' ? ' (מאסטר)' : '');
    wireBubbleBody(user);
  }

  // Wires everything inside the currently-rendered bubble body -- called
  // once from wire() (initial open) and again from repaintBubble() after
  // any bubble action.
  function wireBubbleBody(user) {
    if (user.role === 'admin') return;

    // ליווי אישי always implies הכספת access (never the reverse) -- same
    // rule usersStore.update itself enforces as a safety net; this just
    // keeps the bubble's own checkboxes visually in sync with it.
    const pgCheckbox = container.querySelector('input[name="userBubbleSection"][value="personalGuidance"]');
    const vaultCheckbox = container.querySelector('input[name="userBubbleSection"][value="vault"]');
    function syncVaultLock() {
      if (!pgCheckbox || !vaultCheckbox) return;
      if (pgCheckbox.checked) {
        vaultCheckbox.checked = true;
        vaultCheckbox.disabled = true;
      } else {
        vaultCheckbox.disabled = false;
      }
    }
    if (pgCheckbox) {
      syncVaultLock();
      pgCheckbox.addEventListener('change', async () => {
        syncVaultLock();
        await savePermissions();
      });
    }

    async function savePermissions() {
      const checkedIds = Array.from(container.querySelectorAll('input[name="userBubbleSection"]:checked')).map((el) => el.value);
      const permissions = SECTIONS.reduce((acc, s) => {
        acc[s.id] = checkedIds.includes(s.id);
        return acc;
      }, {});
      await usersStore.update(user.id, { permissions });
    }

    container.querySelectorAll('input[name="userBubbleSection"]').forEach((cb) => {
      if (cb === pgCheckbox) return; // already wired above (needs the lock-sync first)
      cb.addEventListener('change', savePermissions);
    });

    const expiryInput = container.querySelector('#userBubbleExpiry');
    if (expiryInput) {
      expiryInput.addEventListener('change', async () => {
        await usersStore.update(user.id, { accessExpiryDate: expiryInput.value || null });
        await repaintBubble();
      });
    }

    container.querySelectorAll('[data-user-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.userAction;
        if (action === 'edit') {
          bubbleEditing = true;
          await repaintBubble();
        } else if (action === 'toggle-status') {
          await usersStore.update(user.id, { status: user.status === 'active' ? 'blocked' : 'active' });
          await repaintBubble();
        } else if (action === 'reset-password') {
          const newPassword = generateTempPassword();
          btn.disabled = true;
          const ok = await usersStore.resetPassword(user.id, newPassword);
          btn.disabled = false;
          if (ok) {
            generatedPassword = newPassword;
          } else {
            generatedPassword = null;
            window.alert('יצירת הסיסמה הזמנית נכשלה, נסה שוב.');
          }
          await repaintBubble();
        } else if (action === 'delete') {
          if (!window.confirm('למחוק את המשתמש? הפעולה בלתי הפיכה.')) return;
          await usersStore.remove(user.id);
          openUserId = null;
          bubbleEditing = false;
          resetPasswordState();
          const overlay = container.querySelector('#userBubbleOverlay');
          if (overlay) overlay.hidden = true;
          await render();
        }
      });
    });

    const editForm = container.querySelector('#userEditForm');
    if (editForm) {
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = container.querySelector('#userEditName').value.trim();
        const status = container.querySelector('#userEditStatus').value;
        if (!fullName) return;
        const submitBtn = editForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        await usersStore.update(user.id, { fullName, status });
        submitBtn.disabled = false;
        bubbleEditing = false;
        await repaintBubble();
      });
    }
    const editCancel = container.querySelector('#userEditCancel');
    if (editCancel) {
      editCancel.addEventListener('click', async () => {
        bubbleEditing = false;
        await repaintBubble();
      });
    }

    const copyPwBtn = container.querySelector('#copyGeneratedPwBtn');
    if (copyPwBtn) {
      copyPwBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(generatedPassword || '');
          copyPwBtn.textContent = 'הועתק ✓';
        } catch (e) {
          /* clipboard unavailable -- the password is still visible to copy by hand */
        }
      });
    }
  }

  function wire() {
    wireAccordions(container, { state: openAccordions });

    const form = container.querySelector('#userForm');
    const errorEl = container.querySelector('#userFormError');

    function showError(text) {
      errorEl.textContent = text;
      errorEl.classList.add('show');
    }

    // Same ליווי-אישי-implies-הכספת lock, for the create form's own
    // checkboxes.
    const personalGuidanceCheckbox = container.querySelector('input[name="sections"][value="personalGuidance"]');
    const vaultCheckbox = container.querySelector('input[name="sections"][value="vault"]');
    function syncVaultLock() {
      if (!personalGuidanceCheckbox || !vaultCheckbox) return;
      if (personalGuidanceCheckbox.checked) {
        vaultCheckbox.checked = true;
        vaultCheckbox.disabled = true;
      } else {
        vaultCheckbox.disabled = false;
      }
    }
    if (personalGuidanceCheckbox) {
      syncVaultLock();
      personalGuidanceCheckbox.addEventListener('change', syncVaultLock);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fullName = container.querySelector('#fullName').value.trim();
      const username = container.querySelector('#uUsername').value.trim();
      const password = container.querySelector('#uPassword').value;
      const status = container.querySelector('#uStatus').value;
      const accessExpiryDate = container.querySelector('#uExpiry').value || null;
      const checkedIds = Array.from(container.querySelectorAll('input[name="sections"]:checked')).map((el) => el.value);
      const permissions = SECTIONS.reduce((acc, s) => {
        acc[s.id] = checkedIds.includes(s.id);
        return acc;
      }, {});

      if (!fullName || !username || !password) {
        showError('יש למלא שם מלא, אימייל וסיסמה.');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

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
      if (accessExpiryDate) {
        await usersStore.update(result.id, { accessExpiryDate });
      }
      openAccordions.delete('create-user');
      await render();
    });

    const overlay = container.querySelector('#userBubbleOverlay');
    const closeBubble = () => {
      overlay.hidden = true;
      openUserId = null;
      bubbleEditing = false;
      resetPasswordState();
    };
    container.querySelector('#userBubbleClose')?.addEventListener('click', closeBubble);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeBubble();
    });

    wireUserButtons();

    const searchInput = container.querySelector('#userSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        container.querySelector('#userListWrap').innerHTML = userListHTML();
        wireUserButtons();
      });
    }

    const openUser = openUserId ? users.find((u) => u.id === openUserId) : null;
    if (openUser) wireBubbleBody(openUser);
  }

  await render();
}
