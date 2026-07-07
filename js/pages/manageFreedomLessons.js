// Admin management for the "מהישרדות לחופש" section: a lesson list (add/
// edit/delete/reorder/toggle-active) and, per lesson, a messages list with
// the same operations. Two mount functions, same local render()/wire()
// closure pattern as manageUsers.js.

import { freedomStore } from '../data/freedomStore.js';

function loadingHTML() {
  return '<div class="placeholder-page"><div class="placeholder-badge">טוען...</div></div>';
}

export async function mountManageFreedomLessons(container) {
  let editingId = null;

  function lessonRow(lesson) {
    const hasVideo = lesson.embedUrl ? '<span class="badge badge-active">יש וידאו</span>' : '<span class="badge">אין וידאו</span>';
    return `
      <tr data-id="${lesson.id}">
        <td>${lesson.title}</td>
        <td><span class="badge ${lesson.isActive ? 'badge-active' : 'badge-blocked'}">${lesson.isActive ? 'פעיל' : 'לא פעיל'}</span></td>
        <td>${hasVideo}</td>
        <td class="actions-cell">
          <button type="button" class="btn-ghost small" data-action="move-up" title="הזז למעלה">↑</button>
          <button type="button" class="btn-ghost small" data-action="move-down" title="הזז למטה">↓</button>
          <a class="btn-ghost small" href="#/admin/manage-freedom/${lesson.id}">מסרים</a>
          <button type="button" class="btn-ghost small" data-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small" data-action="toggle-active">${lesson.isActive ? 'השבתה' : 'הפעלה'}</button>
          <button type="button" class="btn-ghost small danger" data-action="delete">מחיקה</button>
        </td>
      </tr>`;
  }

  async function render() {
    const lessons = await freedomStore.lessons.getAll();
    const editing = editingId ? await freedomStore.lessons.getById(editingId) : null;

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">ניהול מהישרדות לחופש</h1>
          <p class="placeholder-desc">הוספה, עריכה, מחיקה וסידור של שיעורי הסקשן.</p>
        </div>

        <div class="panel-card">
          <h2 class="form-title">${editing ? `עריכת שיעור: ${editing.title}` : 'הוספת שיעור חדש'}</h2>
          <form id="lessonForm" novalidate>
            <div class="field-group">
              <label for="lTitle">כותרת</label>
              <input type="text" id="lTitle" placeholder="כותרת השיעור" value="${editing ? editing.title : ''}">
            </div>
            <div class="field-group">
              <label for="lDescription">תיאור</label>
              <input type="text" id="lDescription" placeholder="תיאור קצר של השיעור" value="${editing ? editing.description : ''}">
            </div>
            <div class="field-group">
              <label for="lEmbedUrl">קישור Embed (Spotlightr)</label>
              <input type="text" id="lEmbedUrl" placeholder="https://..." value="${editing ? editing.embedUrl : ''}">
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
              <tbody>${lessons.map(lessonRow).join('')}</tbody>
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

    function showError(text) {
      errorEl.textContent = text;
      errorEl.classList.add('show');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = container.querySelector('#lTitle').value.trim();
      const description = container.querySelector('#lDescription').value.trim();
      const embedUrl = container.querySelector('#lEmbedUrl').value.trim();
      const isActive = container.querySelector('#lStatus').value === 'active';

      if (!title) {
        showError('יש למלא כותרת לשיעור.');
        return;
      }

      if (editingId) {
        await freedomStore.lessons.update(editingId, { title, description, embedUrl, isActive });
      } else {
        await freedomStore.lessons.create({ title, description, embedUrl, isActive });
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
          if (window.confirm('למחוק את השיעור? כל המסרים המשויכים אליו יימחקו גם הם.')) {
            await freedomStore.lessons.remove(id);
            if (editingId === id) editingId = null;
            await render();
          }
        } else if (action === 'toggle-active') {
          const lesson = await freedomStore.lessons.getById(id);
          await freedomStore.lessons.update(id, { isActive: !lesson.isActive });
          await render();
        } else if (action === 'move-up') {
          await freedomStore.lessons.moveUp(id);
          await render();
        } else if (action === 'move-down') {
          await freedomStore.lessons.moveDown(id);
          await render();
        }
      });
    });
  }

  container.innerHTML = loadingHTML();
  await render();
}

export async function mountManageFreedomMessages(container, lessonId) {
  let editingId = null;

  container.innerHTML = loadingHTML();
  const lesson = await freedomStore.lessons.getById(lessonId);

  if (!lesson) {
    container.innerHTML = `
      <div class="placeholder-page">
        <h1 class="gold-title placeholder-title">השיעור לא נמצא</h1>
        <a href="#/admin/manage-freedom" class="btn-gold placeholder-back">חזרה לרשימת השיעורים</a>
      </div>`;
    return;
  }

  function messageRow(msg) {
    return `
      <tr data-id="${msg.id}">
        <td>${msg.text}</td>
        <td class="actions-cell">
          <button type="button" class="btn-ghost small" data-action="move-up" title="הזז למעלה">↑</button>
          <button type="button" class="btn-ghost small" data-action="move-down" title="הזז למטה">↓</button>
          <button type="button" class="btn-ghost small" data-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-action="delete">מחיקה</button>
        </td>
      </tr>`;
  }

  async function render() {
    const messages = await freedomStore.messages.getByLessonId(lessonId);
    const editing = editingId ? messages.find((m) => m.id === editingId) : null;

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <a href="#/admin/manage-freedom" class="btn-ghost small back-link">חזרה לרשימת השיעורים</a>
          <h1 class="gold-title placeholder-title">מסרים עבור: ${lesson.title}</h1>
          <p class="placeholder-desc">מסרים אלו נפתחים למשתמש לאחר שהוא מסמן שיעור זה כ"צפיתי".</p>
        </div>

        <div class="panel-card">
          <h2 class="form-title">${editing ? 'עריכת מסר' : 'הוספת מסר חדש'}</h2>
          <form id="messageForm" novalidate>
            <div class="field-group">
              <label for="mText">טקסט המסר</label>
              <input type="text" id="mText" placeholder="תוכן המסר שייחשף למשתמש" value="${editing ? editing.text : ''}">
            </div>

            <div class="error-msg" id="messageFormError" role="alert"></div>

            <div class="form-actions">
              <button type="submit" class="btn-gold">${editing ? 'שמירת שינויים' : 'הוספת מסר'}</button>
              ${editing ? '<button type="button" class="btn-ghost" id="cancelEdit">ביטול</button>' : ''}
            </div>
          </form>
        </div>

        <div class="panel-card">
          <h2 class="form-title">מסרים קיימים</h2>
          <div class="table-scroll">
            <table class="users-table">
              <thead><tr><th>טקסט</th><th>פעולות</th></tr></thead>
              <tbody>${messages.map(messageRow).join('') || '<tr><td colspan="2">אין עדיין מסרים לשיעור זה.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    wire();
  }

  function wire() {
    const form = container.querySelector('#messageForm');
    const errorEl = container.querySelector('#messageFormError');
    const cancelBtn = container.querySelector('#cancelEdit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = container.querySelector('#mText').value.trim();

      if (!text) {
        errorEl.textContent = 'יש למלא טקסט למסר.';
        errorEl.classList.add('show');
        return;
      }

      if (editingId) {
        await freedomStore.messages.update(editingId, { text });
      } else {
        await freedomStore.messages.create({ linkedLessonId: lessonId, text });
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
          if (window.confirm('למחוק את המסר?')) {
            await freedomStore.messages.remove(id);
            if (editingId === id) editingId = null;
            await render();
          }
        } else if (action === 'move-up') {
          await freedomStore.messages.moveUp(id);
          await render();
        } else if (action === 'move-down') {
          await freedomStore.messages.moveDown(id);
          await render();
        }
      });
    });
  }

  await render();
}
