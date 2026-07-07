// Hash router. Resolves a URL hash to a route description and renders the
// content for it. Nested content routes (section -> course -> lesson) are
// validated here (permission + isActive) and dispatched to the mount
// functions in pages/contentViewer.js. The survivalToFreedom section uses
// its own flat lesson+message model (pages/freedomSection.js) instead of
// the generic course model — see resolveRoute's FREEDOM_SECTION_ID branch.
//
// Now async throughout: every store call here hits Supabase over the
// network instead of reading localStorage synchronously. auth.isAdmin()/
// hasAccess() stay synchronous (sessionStorage cache) -- only the content-
// fetching permission checks (isActive lookups) need awaiting.

import { SECTIONS, ADMIN_SECTION, ADMIN_TOOLS } from './sections.config.js';
import { auth } from './auth.js';
import { contentStore } from './data/contentStore.js';
import { freedomStore } from './data/freedomStore.js';
import { vaultStore } from './data/vaultStore.js';
import { mountManageUsers } from './pages/manageUsers.js';
import { mountSectionHome, mountCourseDetail, mountLessonView } from './pages/contentViewer.js';
import { mountFreedomHome, mountFreedomLesson } from './pages/freedomSection.js';
import { mountVaultHome, mountVaultLesson } from './pages/vaultSection.js';
import { mountBotHome } from './pages/botSection.js';
import { editableField, wireEditableFields } from './inlineEdit.js';

const FREEDOM_SECTION_ID = 'survivalToFreedom';
const VAULT_SECTION_ID = 'vault';
const BOT_SECTION_ID = 'jauriusBot';

function renderPlaceholder(title, description) {
  return `
    <div class="placeholder-page">
      <h1 class="gold-title placeholder-title">${title}</h1>
      <p class="placeholder-desc">${description}</p>
      <div class="placeholder-badge">התוכן יתווסף בהמשך</div>
    </div>`;
}

function renderNoAccess() {
  return `
    <div class="placeholder-page">
      <h1 class="gold-title placeholder-title">אין גישה</h1>
      <p class="placeholder-desc">אין לך הרשאה לצפות באזור הזה</p>
      <a href="#/" class="btn-gold placeholder-back">חזרה לדאשבורד</a>
    </div>`;
}

function renderAdminHome() {
  const cards = ADMIN_TOOLS.map(
    (tool) => `
    <a class="admin-card" href="#/admin/${tool.id}">
      <h3>${tool.label}</h3>
      <p>${tool.description}</p>
    </a>`
  ).join('');

  return `
    <div class="admin-home">
      <h1 class="gold-title placeholder-title">${ADMIN_SECTION.label}</h1>
      <p class="placeholder-desc">בחר כלי ניהול. כל הכלים כרגע במצב placeholder.</p>
      <div class="admin-grid">${cards}</div>
    </div>`;
}

async function renderDashboardHome(session) {
  const isAdmin = session.role === 'admin';
  const editMode = auth.isEditMode();
  const visible = [];
  for (const s of SECTIONS) {
    if (!isAdmin && !session.permissions[s.id]) continue;
    const record = await contentStore.sections.getById(s.id);
    if (editMode || !record || record.isActive) visible.push({ config: s, record });
  }

  const cards = visible
    .map(({ config: s, record }) => {
      const label = (record && record.title) || s.label;
      const description = (record && record.description) || s.description;
      const titleHTML = editMode ? editableField(s.id, 'title', label) : escapeHtml(label);
      const descHTML = editMode
        ? editableField(s.id, 'description', description, { multiline: true })
        : escapeHtml(description);
      return `
    <a class="section-card" href="#/${s.id}">
      <span class="section-card-icon">${s.icon}</span>
      <h3>${titleHTML}</h3>
      <p>${descHTML}</p>
    </a>`;
    })
    .join('');

  return `
    <div class="admin-home">
      <h1 class="gold-title placeholder-title">הכספת שלך</h1>
      <p class="placeholder-desc">בחר אזור כדי להתחיל.</p>
      <div class="section-grid">${cards}</div>
    </div>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function saveSectionField(id, field, value) {
  await contentStore.sections.update(id, { [field]: value });
}

async function mountDashboardHome(container, session) {
  async function render() {
    container.innerHTML = await renderDashboardHome(session);
    wireEditableFields(container, { onSave: saveSectionField, rerender: render });
  }
  await render();
}

async function resolveRoute(hash) {
  const path = (hash || '').replace(/^#\/?/, '');
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { home: true };
  }

  if (parts[0] === 'admin') {
    if (!auth.isEditMode()) return { denied: true };
    if (parts.length === 1) return { admin: true };
    const tool = ADMIN_TOOLS.find((t) => t.id === parts[1]);
    if (!tool) return { notFound: true };
    if (parts.length > 2) return { notFound: true };
    return { adminTool: tool };
  }

  const section = SECTIONS.find((s) => s.id === parts[0]);
  if (!section) return { notFound: true };
  if (!auth.hasAccess(section.id)) return { denied: true };

  // Content-visibility bypass follows edit mode, not raw admin status --
  // in user-experience mode the master should see exactly what a regular
  // user sees (inactive content included), even though their real
  // permissions/RLS access never change.
  const isAdmin = auth.isEditMode();
  const sectionRecord = await contentStore.sections.getById(section.id);
  if (!isAdmin && sectionRecord && !sectionRecord.isActive) return { notFound: true };

  if (section.id === FREEDOM_SECTION_ID) {
    if (parts.length === 1) return { freedomHome: true, section };
    if (parts[1] === 'lesson' && parts[2]) {
      const lesson = await freedomStore.lessons.getById(parts[2]);
      if (!lesson) return { notFound: true };
      if (!isAdmin && !lesson.isActive) return { notFound: true };
      return { freedomLesson: true, section, lesson };
    }
    return { notFound: true };
  }

  if (section.id === VAULT_SECTION_ID) {
    if (parts.length === 1) return { vaultHome: true, section };
    if (parts[1] === 'lesson' && parts[2]) {
      const lesson = await vaultStore.lessons.getById(parts[2]);
      if (!lesson) return { notFound: true };
      if (!isAdmin && !lesson.isActive) return { notFound: true };
      return { vaultLesson: true, section, lesson };
    }
    return { notFound: true };
  }

  if (section.id === BOT_SECTION_ID) {
    if (parts.length === 1) return { botHome: true, section };
    return { notFound: true };
  }

  if (parts.length === 1) return { sectionHome: true, section };

  if (parts[1] === 'course' && parts[2]) {
    const course = await contentStore.courses.getById(parts[2]);
    if (!course || course.sectionId !== section.id) return { notFound: true };
    if (!isAdmin && !course.isActive) return { notFound: true };

    if (parts.length === 3) return { courseDetail: true, section, course };

    if (parts[3] === 'lesson' && parts[4]) {
      const les = await contentStore.lessons.getById(parts[4]);
      const mod = les ? await contentStore.modules.getById(les.moduleId) : null;
      if (!les || !mod || mod.courseId !== course.id) return { notFound: true };
      if (!isAdmin && !les.isActive) return { notFound: true };
      return { lessonView: true, section, course, lesson: les };
    }
  }

  return { notFound: true };
}

export async function renderRoute(container, hash) {
  const route = await resolveRoute(hash);
  const session = auth.getSession();

  if (route.denied) {
    container.innerHTML = renderNoAccess();
    return { activeId: null, title: 'אין גישה' };
  }
  if (route.notFound) {
    container.innerHTML = renderPlaceholder('הדף לא נמצא', 'הנתיב המבוקש אינו קיים.');
    return { activeId: null, title: 'לא נמצא' };
  }
  if (route.home) {
    await mountDashboardHome(container, session);
    return { activeId: null, title: 'הכספת' };
  }
  if (route.admin) {
    container.innerHTML = renderAdminHome();
    return { activeId: 'admin', title: ADMIN_SECTION.label };
  }
  if (route.adminTool) {
    if (route.adminTool.id === 'manage-users') {
      await mountManageUsers(container);
    } else {
      container.innerHTML = renderPlaceholder(route.adminTool.label, route.adminTool.description);
    }
    return { activeId: 'admin', title: route.adminTool.label };
  }
  if (route.sectionHome) {
    await mountSectionHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
  if (route.courseDetail) {
    await mountCourseDetail(container, route.section, route.course, session);
    return { activeId: route.section.id, title: route.course.title };
  }
  if (route.lessonView) {
    await mountLessonView(container, route.section, route.course, route.lesson, session);
    return { activeId: route.section.id, title: route.lesson.title };
  }
  if (route.freedomHome) {
    await mountFreedomHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
  if (route.freedomLesson) {
    await mountFreedomLesson(container, route.section, route.lesson, session);
    return { activeId: route.section.id, title: route.lesson.title };
  }
  if (route.vaultHome) {
    await mountVaultHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
  if (route.vaultLesson) {
    await mountVaultLesson(container, route.section, route.lesson, session);
    return { activeId: route.section.id, title: route.lesson.title };
  }
  if (route.botHome) {
    await mountBotHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
}
