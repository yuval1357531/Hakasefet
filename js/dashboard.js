// Dashboard shell entry point: guards the page, builds the sidebar from
// sections.config.js filtered by the current user's permissions, and
// mounts the hash router into #content.

import { SECTIONS, ADMIN_SECTION } from './sections.config.js';
import { auth } from './auth.js';
import { renderRoute } from './router.js';
import { contentStore } from './data/contentStore.js';

// Top-level await -- native ES module feature, no bundler needed.
const session = await auth.requireSession();
if (session) init(session);

async function init(session) {
  const sidebar = document.getElementById('sidebar');
  const sidebarNav = document.getElementById('sidebarNav');
  const content = document.getElementById('content');
  const pageTitle = document.getElementById('pageTitle');
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const userAvatar = document.getElementById('userAvatar');
  const toggleBtn = document.getElementById('sidebarToggle');
  const overlay = document.getElementById('sidebarOverlay');
  const logoutBtn = document.getElementById('logoutBtn');
  const modeToggleBtn = document.getElementById('modeToggleBtn');
  const modeToggleIcon = document.getElementById('modeToggleIcon');
  const modeToggleLabel = document.getElementById('modeToggleLabel');

  const displayName = session.fullName || session.username || 'משתמש';
  userName.textContent = displayName;
  userRole.textContent = session.role === 'admin' ? 'מאסטר המערכת' : 'משתמש';
  userAvatar.textContent = displayName.charAt(0).toUpperCase();

  const visibleSections = SECTIONS.filter(
    (s) => session.role === 'admin' || session.permissions[s.id]
  );

  function navItemHTML(id, label, icon) {
    return `<a class="nav-item" data-id="${id}" href="#/${id}">
      <span class="nav-icon">${icon}</span>
      <span class="nav-label">${label}</span>
    </a>`;
  }

  // Section labels can be renamed inline (edit mode) via contentStore's
  // `sections` table -- blend that over the static config so a rename shows
  // up here too, not just on the pages that display it directly.
  async function buildNav() {
    const records = await contentStore.sections.getAll();
    const titleById = new Map(records.map((r) => [r.id, r.title]));
    let navHtml = visibleSections
      .map((s) => navItemHTML(s.id, titleById.get(s.id) || s.label, s.icon))
      .join('');
    if (auth.isEditMode()) {
      navHtml += `<div class="nav-divider"></div>${navItemHTML(ADMIN_SECTION.id, ADMIN_SECTION.label, ADMIN_SECTION.icon)}`;
    }
    sidebarNav.innerHTML = navHtml;
  }

  await buildNav();

  // Master-only mode toggle: switch between full edit access and browsing
  // the site exactly as a regular user would, without logging out. Real
  // permissions never change -- only which UI/routes are reachable.
  if (session.role === 'admin') {
    modeToggleBtn.hidden = false;

    function renderModeToggle() {
      const editMode = auth.isEditMode();
      modeToggleBtn.classList.toggle('is-edit', editMode);
      modeToggleBtn.classList.toggle('is-user', !editMode);
      modeToggleIcon.textContent = editMode ? '✎' : '👁';
      modeToggleLabel.textContent = editMode ? 'מצב עריכה — ON' : 'מצב חוויית משתמש — OFF';
      modeToggleBtn.title = editMode
        ? 'לחיצה למעבר למצב חוויית משתמש'
        : 'לחיצה למעבר למצב עריכה';
    }

    renderModeToggle();

    modeToggleBtn.addEventListener('click', async () => {
      const switchingToUserMode = auth.isEditMode();
      auth.setViewMode(switchingToUserMode ? 'user' : 'edit');
      renderModeToggle();
      await buildNav();
      if (switchingToUserMode && window.location.hash.startsWith('#/admin')) {
        window.location.hash = '#/';
      } else {
        await handleRoute();
      }
    });
  }

  function setActive(activeId) {
    sidebarNav.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === activeId);
    });
  }

  function isMobile() {
    return window.innerWidth <= 900;
  }

  function openSidebar() {
    document.body.classList.add('sidebar-open');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  async function handleRoute() {
    const result = await renderRoute(content, window.location.hash);
    setActive(result.activeId);
    pageTitle.textContent = result.title || 'הכספת';
    content.scrollTop = 0;
    if (isMobile()) closeSidebar();
    await buildNav();
    setActive(result.activeId);
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  overlay.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => {
    if (!isMobile()) openSidebar();
  });

  if (!isMobile()) openSidebar();

  logoutBtn.addEventListener('click', async () => {
    await auth.logout();
    window.location.href = 'login.html';
  });
}
