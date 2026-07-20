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
import { personalGuidanceStore } from './data/personalGuidanceStore.js';
import { mountManageUsers } from './pages/manageUsers.js';
import { mountSectionHome, mountCourseDetail, mountLessonView } from './pages/contentViewer.js';
import { mountFreedomHome, mountFreedomLesson } from './pages/freedomSection.js';
import { mountVaultHome, mountVaultLesson } from './pages/vaultSection.js';
import { mountPersonalGuidanceHome, mountPersonalGuidanceLesson } from './pages/personalGuidanceSection.js';
import { mountBotHome } from './pages/botSection.js';
import { mountPersonalPage } from './pages/personalArea.js';
import { mountStudentFolders, computeJournalNewCounts } from './pages/studentFolders.js';
import { usersStore } from './data/usersStore.js';
import { notebookStore } from './data/notebookStore.js';
import { mountPersonalAreaPreview } from './pages/personalAreaPreview.js';
import { mountLoginHistory } from './pages/loginHistory.js';

const FREEDOM_SECTION_ID = 'survivalToFreedom';
const VAULT_SECTION_ID = 'vault';
const BOT_SECTION_ID = 'jauriusBot';
const PERSONAL_GUIDANCE_SECTION_ID = 'personalGuidance';
const PERSONAL_ROUTE_ID = 'me';

function renderPlaceholder(title, description) {
  return `
    <div class="placeholder-page">
      <h1 class="gold-title placeholder-title">${title}</h1>
      <p class="placeholder-desc">${description}</p>
      <div class="placeholder-badge">התוכן יתווסף בהמשך</div>
    </div>`;
}

// Small round back affordance for internal/secondary pages only (opened
// from another page -- admin tools, lesson views). The four main section
// landings (personal area, הכספת, מהישרדות לחופש, הבוט) never get one --
// the diamond peek is their only way back, per the section-picker design.
function prependBackButton(container) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'page-back-btn';
  btn.setAttribute('aria-label', 'חזרה');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  btn.addEventListener('click', () => window.history.back());
  container.prepend(btn);
}

function renderNoAccess() {
  return `
    <div class="placeholder-page">
      <h1 class="gold-title placeholder-title">אין גישה</h1>
      <p class="placeholder-desc">אין לך הרשאה לצפות באזור הזה</p>
      <a href="#/" class="btn-gold placeholder-back">חזרה לדאשבורד</a>
    </div>`;
}

// Small quiet count on the "תיקים ויומני תלמידים" card -- how many
// students have new journal entries since the master last opened their
// folder (same computeJournalNewCounts studentFolders.js itself uses, so
// the two can never disagree). One extra fetch, only on this one route.
async function studentFoldersBadgeCount() {
  const [users, entries] = await Promise.all([usersStore.getAll(), notebookStore.getAll()]);
  const students = users.filter((u) => u.role !== 'admin');
  return computeJournalNewCounts(students, entries).size;
}

async function renderAdminHome() {
  const studentFoldersBadge = await studentFoldersBadgeCount();
  const cards = ADMIN_TOOLS.map((tool) => {
    const badge =
      tool.id === 'student-folders' && studentFoldersBadge > 0
        ? `<span class="admin-badge">${studentFoldersBadge}</span>`
        : '';
    return `
    <a class="admin-card" href="#/admin/${tool.id}">
      <h3>${tool.label}${badge}</h3>
      <p>${tool.description}</p>
    </a>`;
  }).join('');

  return `
    <div class="admin-home">
      <h1 class="gold-title placeholder-title">${ADMIN_SECTION.label}</h1>
      <p class="placeholder-desc">בחר כלי ניהול. כל הכלים כרגע במצב placeholder.</p>
      <div class="admin-grid">${cards}</div>
    </div>`;
}

async function resolveRoute(hash) {
  const path = (hash || '').replace(/^#\/?/, '');
  const parts = path.split('/').filter(Boolean);

  // The personal page is the default landing spot after login (bare '#/')
  // and also reachable at its own stable '#/me' -- the section-picker grid
  // it used to show is gone; the sidebar nav is the only picker now.
  if (parts.length === 0 || parts[0] === PERSONAL_ROUTE_ID) {
    return { personalHome: true };
  }

  if (parts[0] === 'admin') {
    if (!auth.isAdmin()) return { denied: true };
    if (parts.length === 1) return { admin: true };
    const tool = ADMIN_TOOLS.find((t) => t.id === parts[1]);
    if (!tool) return { notFound: true };
    if (parts.length > 2) return { notFound: true };
    return { adminTool: tool };
  }

  const section = SECTIONS.find((s) => s.id === parts[0]);
  if (!section) return { notFound: true };
  // alwaysVisibleLocked sections (currently just ליווי אישי) are never
  // hard-denied at the router -- the section's own mount function shows a
  // clean "locked" placeholder instead when the visitor lacks access, per
  // the "עדיין רואה את הכפתור, אבל נעול" requirement.
  if (!auth.hasAccess(section.id) && !section.alwaysVisibleLocked) return { denied: true };

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

  if (section.id === PERSONAL_GUIDANCE_SECTION_ID) {
    if (parts.length === 1) return { personalGuidanceHome: true, section };
    if (parts[1] === 'lesson' && parts[2]) {
      // A locked visitor (see the alwaysVisibleLocked carve-out above)
      // never even reaches personalGuidanceStore here -- hasAccess is
      // checked again, matching every other section's lesson lookup, so a
      // direct lesson URL can't be used to peek at content past the lock.
      if (!auth.hasAccess(section.id)) return { personalGuidanceLesson: false, personalGuidanceHome: true, section };
      const lesson = await personalGuidanceStore.lessons.getById(parts[2]);
      if (!lesson) return { notFound: true };
      if (!isAdmin && !lesson.isActive) return { notFound: true };
      return { personalGuidanceLesson: true, section, lesson };
    }
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
  if (route.personalHome) {
    await mountPersonalPage(container, session);
    return { activeId: PERSONAL_ROUTE_ID, title: session.role === 'admin' ? "שלום ג'אוריוס האגדי" : 'האזור האישי' };
  }
  if (route.admin) {
    container.innerHTML = await renderAdminHome();
    prependBackButton(container);
    return { activeId: 'admin', title: ADMIN_SECTION.label };
  }
  if (route.adminTool) {
    if (route.adminTool.id === 'manage-users') {
      await mountManageUsers(container);
    } else if (route.adminTool.id === 'student-folders') {
      await mountStudentFolders(container);
    } else if (route.adminTool.id === 'personal-area-preview') {
      await mountPersonalAreaPreview(container);
    } else if (route.adminTool.id === 'login-history') {
      await mountLoginHistory(container);
    } else {
      container.innerHTML = renderPlaceholder(route.adminTool.label, route.adminTool.description);
    }
    prependBackButton(container);
    return { activeId: 'admin', title: route.adminTool.label };
  }
  if (route.sectionHome) {
    await mountSectionHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
  if (route.courseDetail) {
    await mountCourseDetail(container, route.section, route.course, session);
    prependBackButton(container);
    return { activeId: route.section.id, title: route.course.title };
  }
  if (route.lessonView) {
    await mountLessonView(container, route.section, route.course, route.lesson, session);
    prependBackButton(container);
    return { activeId: route.section.id, title: route.lesson.title };
  }
  if (route.freedomHome) {
    await mountFreedomHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
  if (route.freedomLesson) {
    // No prependBackButton here: the back button is baked directly into
    // this page's own template now (see js/pageBackButton.js) since this
    // page's own paint() re-renders container.innerHTML on almost every
    // action, which used to wipe out a button prepended only once here.
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
  if (route.personalGuidanceHome) {
    await mountPersonalGuidanceHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
  if (route.personalGuidanceLesson) {
    await mountPersonalGuidanceLesson(container, route.section, route.lesson, session);
    return { activeId: route.section.id, title: route.lesson.title };
  }
  if (route.botHome) {
    await mountBotHome(container, route.section, session);
    return { activeId: route.section.id, title: route.section.label };
  }
}
