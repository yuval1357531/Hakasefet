// User-facing pages for the "הכספת" section: lesson tabs + top ticker that
// blends admin-authored highlight phrases with approved student comments
// (mountVaultHome), and the single-lesson viewer with the "מצפיתי בשיעור"
// toggle + personal comment form + approved comments for that lesson
// (mountVaultLesson). Watch state reuses progressStore exactly like every
// other lesson engine in the app.
//
// Content-visibility bypass (seeing inactive lessons) follows
// auth.isEditMode() rather than raw auth.isAdmin() -- in user-experience
// mode the master sees exactly what a regular user would see. Edit-mode
// only adds inline management directly on this page (lesson add/reorder/
// hide/delete, embed + hint + description-mode editing, ticker phrase
// management, comment moderation) -- there is no separate /admin page for
// any of this anymore.

import { vaultStore } from '../data/vaultStore.js';
import { commentsStore } from '../data/commentsStore.js';
import { progressStore } from '../data/progressStore.js';
import { contentStore } from '../data/contentStore.js';
import { auth } from '../auth.js';
import { editableField, wireEditableFields, reorderButtonsHTML, wireReorderButtons } from '../inlineEdit.js';

const STATUS_LABELS = { pending: 'ממתין', approved: 'מאושר', hidden: 'מוסתר' };
const STATUS_BADGE = { pending: '', approved: 'badge-active', hidden: 'badge-blocked' };

function loadingHTML() {
  return '<div class="placeholder-page"><div class="placeholder-badge">טוען...</div></div>';
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

// Blends admin-authored highlight phrases with approved student comments
// into one running ticker.
async function communityTicker() {
  const highlights = await vaultStore.highlights.getActive();
  const approved = await commentsStore.getApprovedAll();
  const items = [
    ...highlights.map((h) => `✦ ${escapeHtml(h.text)}`),
    ...approved.map((c) => `✦ ${escapeHtml(c.displayName)}: ${escapeHtml(c.text)}`),
  ];
  if (items.length === 0) {
    return '<div class="insights-empty">עדיין אין משפטים או תגובות מאושרות להצגה</div>';
  }
  const rendered = items.map((t) => `<span class="insights-item">${t}</span>`).join('');
  return `
    <div class="insights-ticker">
      <div class="insights-ticker-track">${rendered}${rendered}</div>
    </div>`;
}

function highlightsManageHTML(highlights) {
  const rows = highlights
    .map(
      (h) => `
      <tr data-id="${h.id}">
        <td>${escapeHtml(h.text)}</td>
        <td><span class="badge ${h.isActive ? 'badge-active' : 'badge-blocked'}">${h.isActive ? 'פעיל' : 'מוסתר'}</span></td>
        <td class="actions-cell">
          <button type="button" class="btn-ghost small" data-hl-action="move-up" title="הזז למעלה">↑</button>
          <button type="button" class="btn-ghost small" data-hl-action="move-down" title="הזז למטה">↓</button>
          <button type="button" class="btn-ghost small" data-hl-action="toggle-active">${h.isActive ? 'הסתרה' : 'הפעלה'}</button>
          <button type="button" class="btn-ghost small danger" data-hl-action="delete">מחיקה</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <div class="panel-card">
      <h2 class="form-title">ניהול משפטים בפס העליון</h2>
      <form id="highlightForm" novalidate>
        <div class="field-group">
          <label for="hlText">משפט או ציטוט חדש</label>
          <input type="text" id="hlText" placeholder="לדוגמה: כל יום שאתה מתמיד הוא ניצחון">
        </div>
        <div class="form-actions"><button type="submit" class="btn-gold">הוספת משפט</button></div>
      </form>
      <div class="table-scroll">
        <table class="users-table">
          <thead><tr><th>טקסט</th><th>סטטוס</th><th>פעולות</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">אין עדיין משפטים.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function wireHighlightsManage(container, rerender) {
  const form = container.querySelector('#highlightForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('#hlText');
    const text = input.value.trim();
    if (!text) return;
    await vaultStore.highlights.create({ text });
    await rerender();
  });

  container.querySelectorAll('[data-hl-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const action = btn.dataset.hlAction;
      if (action === 'move-up') await vaultStore.highlights.moveUp(id);
      else if (action === 'move-down') await vaultStore.highlights.moveDown(id);
      else if (action === 'delete') {
        if (!window.confirm('למחוק את המשפט?')) return;
        await vaultStore.highlights.remove(id);
      } else if (action === 'toggle-active') {
        const all = await vaultStore.highlights.getAll();
        const current = all.find((h) => h.id === id);
        if (current) await vaultStore.highlights.update(id, { isActive: !current.isActive });
      }
      await rerender();
    });
  });
}

async function saveSectionField(id, field, value) {
  await contentStore.sections.update(id, { [field]: value });
}

async function saveLessonField(id, field, value) {
  await vaultStore.lessons.update(id, { [field]: value });
}

export async function mountVaultHome(container, section, session) {
  async function render() {
    container.innerHTML = loadingHTML();

    const editMode = auth.isEditMode();
    const sectionRecord = await contentStore.sections.getById(section.id);
    const label = (sectionRecord && sectionRecord.title) || section.label;
    const description = (sectionRecord && sectionRecord.description) || section.description;

    const lessons = editMode ? await vaultStore.lessons.getAll() : await vaultStore.lessons.getActive();
    const userProgress = await progressStore.getForUser(session.id);
    const completedIds = new Set(userProgress.filter((p) => p.isCompleted).map((p) => p.lessonId));

    const tabs = lessons
      .map((lesson) => {
        const done = completedIds.has(lesson.id);
        const inactiveBadge = !lesson.isActive ? '<span class="badge badge-inactive">לא פעיל</span>' : '';
        const titleHTML = editMode ? editableField(lesson.id, 'title', lesson.title) : escapeHtml(lesson.title);

        if (!editMode) {
          return `
            <a class="lesson-tab ${done ? 'is-done' : ''}" href="#/${section.id}/lesson/${lesson.id}">
              <span class="lesson-tab-check">${done ? '✓' : ''}</span>
              <span class="lesson-tab-title">${titleHTML}</span>
            </a>`;
        }

        return `
          <div class="lesson-tab-edit">
            <a class="lesson-tab ${done ? 'is-done' : ''}" href="#/${section.id}/lesson/${lesson.id}">
              <span class="lesson-tab-check">${done ? '✓' : ''}</span>
              <span class="lesson-tab-title">${titleHTML}</span>
              ${inactiveBadge}
            </a>
            <div class="lesson-tab-tools">
              ${reorderButtonsHTML(lesson.id)}
              <button type="button" class="btn-ghost small" data-lesson-action="toggle-active" data-lesson-id="${lesson.id}">${lesson.isActive ? 'הסתרה' : 'הפעלה'}</button>
              <button type="button" class="btn-ghost small danger" data-lesson-action="delete" data-lesson-id="${lesson.id}">מחיקה</button>
            </div>
          </div>`;
      })
      .join('');

    const empty = lessons.length === 0 ? '<div class="placeholder-badge">התוכן יתווסף בהמשך</div>' : '';
    const tickerHTML = await communityTicker();
    const titleHTML = editMode ? editableField(section.id, 'title', label) : escapeHtml(label);
    const descHTML = editMode
      ? editableField(section.id, 'description', description, { multiline: true })
      : escapeHtml(description);

    const addLessonHTML = editMode
      ? `
      <div class="panel-card">
        <h2 class="form-title">הוספת שיעור חדש</h2>
        <form id="addLessonForm" novalidate>
          <div class="field-group">
            <label for="newLessonTitle">כותרת השיעור</label>
            <input type="text" id="newLessonTitle" placeholder="שם השיעור החדש">
          </div>
          <div class="form-actions"><button type="submit" class="btn-gold">הוספת שיעור</button></div>
        </form>
      </div>`
      : '';

    const highlights = editMode ? await vaultStore.highlights.getAll() : [];
    const highlightsHTML = editMode ? highlightsManageHTML(highlights) : '';

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">${titleHTML}</h1>
          <p class="placeholder-desc">${descHTML}</p>
        </div>
        ${tickerHTML}
        ${addLessonHTML}
        ${empty}
        <div class="lesson-tabs">${tabs}</div>
        ${highlightsHTML}
      </div>`;

    wireEditableFields(container, {
      onSave: async (id, field, value) => {
        if (id === section.id) await saveSectionField(id, field, value);
        else await saveLessonField(id, field, value);
      },
      rerender: render,
    });
    wireReorderButtons(container, {
      onMove: (id, dir) => (dir === 'up' ? vaultStore.lessons.moveUp(id) : vaultStore.lessons.moveDown(id)),
      rerender: render,
    });
    wireHighlightsManage(container, render);

    const addForm = container.querySelector('#addLessonForm');
    if (addForm) {
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = container.querySelector('#newLessonTitle');
        const title = input.value.trim();
        if (!title) return;
        await vaultStore.lessons.create({ title });
        await render();
      });
    }

    container.querySelectorAll('[data-lesson-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.lessonId;
        const action = btn.dataset.lessonAction;
        if (action === 'toggle-active') {
          const lesson = await vaultStore.lessons.getById(id);
          await vaultStore.lessons.update(id, { isActive: !lesson.isActive });
          await render();
        } else if (action === 'delete') {
          if (window.confirm('למחוק את השיעור? כל התגובות המשויכות אליו יימחקו גם הן.')) {
            await vaultStore.lessons.remove(id);
            await commentsStore.removeByLessonId(id);
            await render();
          }
        }
      });
    });
  }

  await render();
}

export async function mountVaultLesson(container, section, lesson, session) {
  async function render() {
    const record = await progressStore.getForLesson(session.id, lesson.id);
    const isCompleted = !!(record && record.isCompleted);
    const approvedComments = await commentsStore.getApprovedByLessonId(lesson.id);
    const freshLesson = (await vaultStore.lessons.getById(lesson.id)) || lesson;
    const editMode = auth.isEditMode();

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
    const embedEditHTML = editMode
      ? `<p class="lesson-embed-edit">קישור וידאו: ${editableField(freshLesson.id, 'embedUrl', freshLesson.embedUrl || '(לא הוגדר)')}</p>`
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

    const seenKey = `vault_desc_seen_${freshLesson.id}`;
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

    const commentModerationHTML = editMode ? await moderationHTML(freshLesson.id) : '';

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <a href="#/${section.id}" class="btn-ghost small back-link">חזרה ל${escapeHtml(section.label)}</a>
        </div>

        <div class="panel-card lesson-panel">
          ${embedHTML(freshLesson.embedUrl)}
          ${embedEditHTML}
          ${hintHTML}
          <div class="lesson-header">
            <h1 class="gold-title placeholder-title">${titleHTML}</h1>
          </div>
          ${descModeRowHTML}
          ${showInlineDesc ? `<p class="lesson-text">${descHTML}</p>` : ''}
          <button type="button" class="watch-btn ${isCompleted ? 'completed' : ''}" id="watchedBtn">
            ${isCompleted ? 'צפית בשיעור ✓ (לחיצה לביטול)' : 'צפיתי בשיעור'}
          </button>
        </div>

        <div class="panel-card">
          <h2 class="form-title">הוספת הערה אישית</h2>
          <form id="commentForm" novalidate>
            <div class="field-group">
              <label for="commentText">ההערה שלך</label>
              <textarea id="commentText" rows="3" placeholder="שתפו תובנה או מחשבה..."></textarea>
            </div>
            <div class="error-msg" id="commentError" role="alert"></div>
            <div class="comment-status" id="commentStatus"></div>
            <div class="form-actions">
              <button type="submit" class="btn-gold">שלח הערה</button>
            </div>
          </form>
        </div>

        <div class="panel-card">
          <h2 class="form-title">תגובות מאושרות</h2>
          <div class="comment-list">${commentsHTML}</div>
        </div>

        ${commentModerationHTML}
      </div>
      ${popupHTML}`;

    container.querySelector('#watchedBtn').addEventListener('click', async () => {
      await progressStore.toggleCompleted(session.id, lesson.id);
      await render();
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
        await vaultStore.lessons.update(freshLesson.id, { descriptionMode: btn.dataset.descMode });
        await render();
      });
    });

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

      await commentsStore.create({
        lessonId: lesson.id,
        userId: session.id,
        displayName: firstName(session.fullName || session.username),
        text,
      });

      textarea.value = '';
      statusEl.textContent = 'ההערה נשלחה וממתינה לאישור';
    });

    wireEditableFields(container, { onSave: saveLessonField, rerender: render });
    wireModeration(container, render);
  }

  container.innerHTML = loadingHTML();
  await render();
}

async function moderationHTML(lessonId) {
  const comments = await commentsStore.getByLessonId(lessonId);
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
    <div class="panel-card">
      <h2 class="form-title">ניהול תגובות לשיעור</h2>
      <div class="table-scroll">
        <table class="users-table">
          <thead><tr><th>משתמש</th><th>הערה</th><th>סטטוס</th><th>פעולות</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">אין עדיין הערות לשיעור זה.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function wireModeration(container, rerender) {
  container.querySelectorAll('[data-comment-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const action = btn.dataset.commentAction;
      if (action === 'approve') await commentsStore.approve(id);
      else if (action === 'hide') await commentsStore.hide(id);
      else if (action === 'delete') {
        if (!window.confirm('למחוק את ההערה?')) return;
        await commentsStore.remove(id);
      }
      await rerender();
    });
  });
}
