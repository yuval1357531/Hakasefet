// "הדרכות חינמיות" -- master-only. Turns any existing vault_lessons row
// into a publicly-shareable "/free/<slug>" page (see api/free-tutorial.js
// for the public read + free.html for the public page itself) without
// duplicating video/content: a FreeTutorial is a thin publication record
// (freeTutorialsStore.js) that only stores a reference (lessonId) plus
// publication metadata (slug/title/active/expiry).
//
// UI pattern follows manageUsers.js's user-bubble modal (list of rows ->
// click "עריכה"/"יצירה" -> a form modal, same overlay/card classes) and
// its accessExpiryDate field convention (optional <input type="date">,
// empty = no expiry).

import { vaultStore } from '../data/vaultStore.js';
import { freeTutorialsStore, slugify } from '../data/freeTutorialsStore.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function isExpired(dateStr) {
  if (!dateStr) return false;
  return dateStr < new Date().toISOString().slice(0, 10);
}

export async function mountFreeTutorials(container) {
  let tutorials = [];
  let lessons = [];
  let openFormId = null; // null = closed, 'new' = create form, else = editing this tutorial id
  let copyFeedbackId = null;

  function lessonTitle(lessonId) {
    const lesson = lessons.find((l) => l.id === lessonId);
    return lesson ? lesson.title : 'שיעור לא ידוע (נמחק?)';
  }

  function publicUrlFor(slug) {
    return `${window.location.origin}/free/${slug}`;
  }

  function tutorialRowHTML(t) {
    const expired = isExpired(t.expiresAt);
    const statusLabel = !t.active ? 'לא פעילה' : expired ? 'פגת תוקף' : 'פעילה';
    const statusClass = !t.active || expired ? 'badge-blocked' : 'badge-active';
    return `
      <div class="free-tutorial-row" data-id="${t.id}">
        <div class="free-tutorial-row-main">
          <span class="free-tutorial-row-title">${escapeHtml(t.publicTitle || lessonTitle(t.lessonId))}</span>
          <span class="muted-note">מתוך שיעור: ${escapeHtml(lessonTitle(t.lessonId))}</span>
          <span class="muted-note" dir="ltr">/free/${escapeHtml(t.slug)}</span>
        </div>
        <div class="free-tutorial-row-meta">
          <span class="badge ${statusClass}">${statusLabel}</span>
          ${t.expiresAt ? `<span class="muted-note">בתוקף עד ${formatDate(t.expiresAt)}</span>` : ''}
        </div>
        <div class="free-tutorial-row-actions">
          <button type="button" class="btn-ghost small" data-action="copy">${copyFeedbackId === t.id ? 'הועתק ✓' : 'העתק קישור'}</button>
          <button type="button" class="btn-ghost small" data-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small" data-action="toggle">${t.active ? 'כיבוי' : 'הפעלה'}</button>
          <button type="button" class="btn-ghost small danger" data-action="delete">מחיקה</button>
        </div>
      </div>`;
  }

  function lessonOptionsHTML(selectedId) {
    if (!lessons.length) return '<option value="">אין שיעורים זמינים בפורטל הכספת</option>';
    return lessons
      .map((l) => `<option value="${escapeAttr(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`)
      .join('');
  }

  function formModalHTML() {
    if (!openFormId) return '';
    const editing = openFormId !== 'new';
    const t = editing ? tutorials.find((x) => x.id === openFormId) : null;
    const title = editing ? 'עריכת הדרכה חינמית' : 'יצירת הדרכה חינמית';
    return `
      <div class="personal-modal-overlay" id="freeTutorialFormOverlay">
        <div class="personal-modal-card panel-card">
          <div class="personal-modal-header">
            <h3 class="personal-block-title">${title}</h3>
            <button type="button" class="personal-modal-close" id="freeTutorialFormClose" aria-label="סגירה">✕</button>
          </div>
          <div class="personal-modal-body">
            <form id="freeTutorialForm" class="user-bubble-edit-form" novalidate>
              <div class="error-msg" id="freeTutorialFormError" role="alert"></div>
              <div class="field-group">
                <label for="ftLesson">שיעור</label>
                <select id="ftLesson">${lessonOptionsHTML(t ? t.lessonId : '')}</select>
              </div>
              <div class="field-group">
                <label for="ftTitle">שם ציבורי להדרכה (לא חובה -- ברירת מחדל: שם השיעור)</label>
                <input type="text" id="ftTitle" value="${escapeAttr(t ? t.publicTitle : '')}">
              </div>
              <div class="field-group">
                <label for="ftSlug">כתובת (slug) -- לדוגמה: pickup</label>
                <input type="text" id="ftSlug" dir="ltr" value="${escapeAttr(t ? t.slug : '')}">
              </div>
              <div class="field-group">
                <label for="ftExpiry">תאריך תפוגה (לא חובה)</label>
                <input type="date" id="ftExpiry" value="${t && t.expiresAt ? t.expiresAt : ''}">
              </div>
              <label class="checkbox-row" style="margin-bottom:14px;">
                <input type="checkbox" id="ftActive" ${!t || t.active ? 'checked' : ''}>
                <span>פעילה</span>
              </label>
              <div class="form-actions">
                <button type="submit" class="btn-gold small">שמירה</button>
                <button type="button" class="btn-ghost small" id="freeTutorialFormCancel">ביטול</button>
              </div>
            </form>
          </div>
        </div>
      </div>`;
  }

  async function render() {
    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">הדרכות חינמיות</h1>
          <p class="placeholder-desc">הפוך שיעור קיים בפורטל תוכן הכספת לדף הדרכה חינמי וציבורי, בכתובת משלו, שאפשר לשלוח לכל אחד -- ללא צורך במשתמש או התחברות.</p>
          <button type="button" class="btn-gold" id="freeTutorialCreateBtn">יצירת הדרכה חינמית</button>
        </div>
        <div class="free-tutorial-list">${
          tutorials.length ? tutorials.map(tutorialRowHTML).join('') : '<p class="placeholder-desc">עדיין לא נוצרו הדרכות חינמיות.</p>'
        }</div>
      </div>
      ${formModalHTML()}`;
    wire();
  }

  function wire() {
    const createBtn = container.querySelector('#freeTutorialCreateBtn');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        openFormId = 'new';
        await render();
      });
    }

    const closeBtn = container.querySelector('#freeTutorialFormClose');
    const cancelBtn = container.querySelector('#freeTutorialFormCancel');
    [closeBtn, cancelBtn].forEach((btn) => {
      if (btn) btn.addEventListener('click', async () => {
        openFormId = null;
        await render();
      });
    });

    const slugInput = container.querySelector('#ftSlug');
    const titleInput = container.querySelector('#ftTitle');
    const lessonSelect = container.querySelector('#ftLesson');
    let slugTouched = !!(slugInput && slugInput.value);
    if (slugInput) {
      slugInput.addEventListener('input', () => {
        slugTouched = true;
      });
    }
    function autoSlugFrom(text) {
      if (slugTouched || !slugInput) return;
      slugInput.value = slugify(text);
    }
    if (titleInput) titleInput.addEventListener('input', () => autoSlugFrom(titleInput.value));
    if (lessonSelect) {
      lessonSelect.addEventListener('change', () => {
        if (!titleInput || !titleInput.value.trim()) autoSlugFrom(lessonTitle(lessonSelect.value));
      });
    }

    const form = container.querySelector('#freeTutorialForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = container.querySelector('#freeTutorialFormError');
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.remove('show');
        }
        const lessonId = container.querySelector('#ftLesson').value;
        const publicTitle = container.querySelector('#ftTitle').value.trim();
        const slug = slugify(container.querySelector('#ftSlug').value);
        const expiresAt = container.querySelector('#ftExpiry').value || null;
        const active = container.querySelector('#ftActive').checked;

        if (!lessonId) {
          if (errorEl) { errorEl.textContent = 'יש לבחור שיעור.'; errorEl.classList.add('show'); }
          return;
        }
        if (!slug) {
          if (errorEl) { errorEl.textContent = 'יש להזין כתובת (slug) תקינה.'; errorEl.classList.add('show'); }
          return;
        }
        if (await freeTutorialsStore.isSlugTaken(slug, openFormId !== 'new' ? openFormId : undefined)) {
          if (errorEl) { errorEl.textContent = 'הכתובת הזו כבר תפוסה על ידי הדרכה אחרת.'; errorEl.classList.add('show'); }
          return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const payload = { lessonId, slug, publicTitle, active, expiresAt };
        const result = openFormId === 'new' ? await freeTutorialsStore.create(payload) : await freeTutorialsStore.update(openFormId, payload);
        submitBtn.disabled = false;

        if (!result.ok) {
          if (errorEl) {
            errorEl.textContent = result.reason === 'slug_taken' ? 'הכתובת הזו כבר תפוסה על ידי הדרכה אחרת.' : 'השמירה נכשלה, נסה שוב.';
            errorEl.classList.add('show');
          }
          return;
        }
        openFormId = null;
        await load();
      });
    }

    container.querySelectorAll('.free-tutorial-row').forEach((row) => {
      const id = row.dataset.id;
      const t = tutorials.find((x) => x.id === id);
      if (!t) return;
      row.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (action === 'copy') {
            try {
              await navigator.clipboard.writeText(publicUrlFor(t.slug));
              copyFeedbackId = t.id;
              await render();
              setTimeout(async () => {
                if (copyFeedbackId === t.id) {
                  copyFeedbackId = null;
                  await render();
                }
              }, 1800);
            } catch (err) {
              window.alert('העתקת הקישור נכשלה. אפשר להעתיק ידנית: ' + publicUrlFor(t.slug));
            }
          } else if (action === 'edit') {
            openFormId = t.id;
            await render();
          } else if (action === 'toggle') {
            await freeTutorialsStore.update(t.id, { active: !t.active });
            await load();
          } else if (action === 'delete') {
            if (!window.confirm('למחוק את ההדרכה החינמית? הקישור הציבורי יפסיק לעבוד מיידית. השיעור המקורי בכספת לא נפגע.')) return;
            await freeTutorialsStore.remove(t.id);
            await load();
          }
        });
      });
    });
  }

  async function load() {
    [tutorials, lessons] = await Promise.all([freeTutorialsStore.getAll(), vaultStore.lessons.getAll()]);
    await render();
  }

  await load();
}
