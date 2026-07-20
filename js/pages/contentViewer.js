// Read-only(-ish) content pages: section home (course cards), course
// detail (modules + lessons in order), and the lesson viewer (the only one
// with real interaction -- the "mark complete" toggle, plus, in edit mode,
// inline editing of titles/descriptions/order). All three talk only to
// contentStore/progressStore/auth, mirroring the manageUsers.js pattern of
// a local render() closure that re-renders itself after a mutation.
//
// Content-visibility bypass (seeing inactive items) follows auth.isEditMode()
// rather than raw auth.isAdmin() -- in user-experience mode the master sees
// exactly what a regular user would see, even though their real permissions
// never change. Inline edit affordances are shown only in edit mode too.

import { contentStore } from '../data/contentStore.js';
import { progressStore } from '../data/progressStore.js';
import { auth } from '../auth.js';
import { editableField, wireEditableFields, reorderButtonsHTML, wireReorderButtons } from '../inlineEdit.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getCourseLessons(courseId, includeInactive) {
  const modules = await contentStore.modules.getByCourseId(courseId);
  let lessons = [];
  for (const m of modules) {
    const moduleLessons = includeInactive
      ? await contentStore.lessons.getByModuleId(m.id)
      : await contentStore.lessons.getActiveByModuleId(m.id);
    lessons = lessons.concat(moduleLessons);
  }
  return lessons;
}

function progressBarHTML(percent, label) {
  return `
    <div class="progress-bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar-fill" style="width: ${percent}%"></div>
    </div>
    <div class="progress-label">${label}</div>`;
}

async function saveSectionField(id, field, value) {
  await contentStore.sections.update(id, { [field]: value });
}

async function saveCourseField(id, field, value) {
  await contentStore.courses.update(id, { [field]: value });
}

async function saveModuleField(id, field, value) {
  await contentStore.modules.update(id, { [field]: value });
}

async function saveLessonField(id, field, value) {
  await contentStore.lessons.update(id, { [field]: value });
}

export async function mountSectionHome(container, section, session) {
  async function render() {
    const editMode = auth.isEditMode();
    const sectionRecord = await contentStore.sections.getById(section.id);
    const label = (sectionRecord && sectionRecord.title) || section.label;
    const description = (sectionRecord && sectionRecord.description) || section.description;

    const courses = editMode
      ? await contentStore.courses.getBySectionId(section.id)
      : await contentStore.courses.getActiveBySectionId(section.id);

    const cardsList = [];
    for (const course of courses) {
      const lessons = await getCourseLessons(course.id, editMode);
      const progress = await progressStore.computeCourseProgress(session.id, course.id, lessons);
      const inactiveBadge = !course.isActive ? '<span class="badge badge-inactive">לא פעיל</span>' : '';
      const progressBadge = lessons.length > 0 ? `<span class="badge">${progress.percent}% הושלם</span>` : '';
      const titleHTML = editMode ? editableField(course.id, 'title', course.title) : escapeHtml(course.title);
      const descHTML = editMode
        ? editableField(course.id, 'description', course.description, { multiline: true })
        : escapeHtml(course.description);
      const reorderHTML = editMode ? `<div class="reorder-row">${reorderButtonsHTML(course.id)}</div>` : '';

      cardsList.push(`
        <a class="course-card" href="#/${section.id}/course/${course.id}">
          <h3>${titleHTML}</h3>
          <p>${descHTML}</p>
          <div class="course-card-meta">${progressBadge}${inactiveBadge}</div>
          ${reorderHTML}
        </a>`);
    }

    const empty = courses.length === 0 ? '<div class="placeholder-badge">התוכן יתווסף בהמשך</div>' : '';
    const titleHTML = editMode ? editableField(section.id, 'title', label) : escapeHtml(label);
    const descHTML = editMode
      ? editableField(section.id, 'description', description, { multiline: true })
      : escapeHtml(description);

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">${titleHTML}</h1>
          <p class="placeholder-desc">${descHTML}</p>
        </div>
        ${empty}
        <div class="course-grid">${cardsList.join('')}</div>
      </div>`;

    wireEditableFields(container, {
      onSave: async (id, field, value) => {
        if (id === section.id) await saveSectionField(id, field, value);
        else await saveCourseField(id, field, value);
      },
      rerender: render,
    });
    wireReorderButtons(container, { onMove: (id, dir) => (dir === 'up' ? contentStore.courses.moveUp(id) : contentStore.courses.moveDown(id)), rerender: render });
  }

  await render();
}

export async function mountCourseDetail(container, section, course, session) {
  async function render() {
    const editMode = auth.isEditMode();
    const modules = await contentStore.modules.getByCourseId(course.id);
    const allLessons = await getCourseLessons(course.id, editMode);
    const progress = await progressStore.computeCourseProgress(session.id, course.id, allLessons);
    const userProgress = await progressStore.getForUser(session.id);
    const completedIds = new Set(userProgress.filter((p) => p.isCompleted).map((p) => p.lessonId));

    const moduleBlocks = [];
    for (const mod of modules) {
      const lessons = editMode
        ? await contentStore.lessons.getByModuleId(mod.id)
        : await contentStore.lessons.getActiveByModuleId(mod.id);
      const rows = lessons
        .map((les) => {
          const done = completedIds.has(les.id);
          const inactiveBadge = !les.isActive ? '<span class="badge badge-inactive">לא פעיל</span>' : '';
          const titleHTML = editMode ? editableField(les.id, 'title', les.title) : escapeHtml(les.title);
          const reorderHTML = editMode ? reorderButtonsHTML(les.id) : '';
          return `
            <div class="lesson-row-edit">
              <a class="lesson-row" href="#/${section.id}/course/${course.id}/lesson/${les.id}">
                <span class="lesson-row-check">${done ? '✓' : ''}</span>
                <span class="lesson-row-title">${titleHTML}</span>
                <span class="badge duration-badge">${escapeHtml(les.duration)}</span>
                ${inactiveBadge}
              </a>
              ${reorderHTML}
            </div>`;
        })
        .join('');

      const modTitleHTML = editMode ? editableField(mod.id, 'title', mod.title) : escapeHtml(mod.title);
      const modReorderHTML = editMode ? `<div class="reorder-row">${reorderButtonsHTML(mod.id)}</div>` : '';

      moduleBlocks.push(`
        <div class="module-block">
          <h3 class="form-title">${modTitleHTML}</h3>
          ${modReorderHTML}
          ${rows || '<p class="placeholder-desc">אין עדיין שיעורים במודול זה.</p>'}
        </div>`);
    }

    const courseTitleHTML = editMode ? editableField(course.id, 'title', course.title) : escapeHtml(course.title);
    const courseDescHTML = editMode
      ? editableField(course.id, 'description', course.description, { multiline: true })
      : escapeHtml(course.description);

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">${courseTitleHTML}</h1>
          <p class="placeholder-desc">${courseDescHTML}</p>
          ${progressBarHTML(progress.percent, `${progress.completed} מתוך ${progress.total} שיעורים הושלמו (${progress.percent}%)`)}
        </div>
        ${moduleBlocks.join('')}
      </div>`;

    wireEditableFields(container, {
      onSave: async (id, field, value) => {
        if (id === course.id) await saveCourseField(id, field, value);
        else if (modules.some((m) => m.id === id)) await saveModuleField(id, field, value);
        else await saveLessonField(id, field, value);
      },
      rerender: render,
    });
    wireReorderButtons(container, {
      onMove: (id, dir) => {
        const isModule = modules.some((m) => m.id === id);
        const store = isModule ? contentStore.modules : contentStore.lessons;
        return dir === 'up' ? store.moveUp(id) : store.moveDown(id);
      },
      rerender: render,
    });
  }

  await render();
}

export async function mountLessonView(container, section, course, lesson, session) {
  async function render() {
    const record = await progressStore.getForLesson(session.id, lesson.id);
    const isCompleted = !!(record && record.isCompleted);
    const freshLesson = (await contentStore.lessons.getById(lesson.id)) || lesson;
    const editMode = auth.isEditMode();

    const attachmentsHTML =
      freshLesson.attachments && freshLesson.attachments.length
        ? `<ul class="lesson-attachments">${freshLesson.attachments.map((a) => `<li><a href="${a.url || '#'}">${a.label || a.url}</a></li>`).join('')}</ul>`
        : '';

    const titleHTML = editMode ? editableField(freshLesson.id, 'title', freshLesson.title) : escapeHtml(freshLesson.title);
    const durationHTML = editMode ? editableField(freshLesson.id, 'duration', freshLesson.duration) : escapeHtml(freshLesson.duration);
    const textHTML = editMode
      ? editableField(freshLesson.id, 'textContent', freshLesson.textContent, { multiline: true })
      : escapeHtml(freshLesson.textContent);

    container.innerHTML = `
      <div class="admin-page">
        <div class="panel-card lesson-panel">
          <div class="video-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>
            <span>אזור נגן הווידאו יתווסף בהמשך</span>
          </div>

          <div class="lesson-header">
            <h1 class="gold-title placeholder-title">${titleHTML}</h1>
            <span class="badge duration-badge">${durationHTML}</span>
          </div>

          <p class="lesson-text">${textHTML}</p>
          ${attachmentsHTML}

          <button type="button" class="btn-gold complete-btn ${isCompleted ? 'completed' : ''}" id="completeBtn">
            ${isCompleted ? 'השיעור הושלם ✓ (לחיצה לביטול)' : 'סמן כהושלם'}
          </button>
        </div>
      </div>`;

    container.querySelector('#completeBtn').addEventListener('click', async () => {
      await progressStore.toggleCompleted(session.id, lesson.id);
      await render();
    });

    wireEditableFields(container, { onSave: saveLessonField, rerender: render });
  }

  await render();
}
