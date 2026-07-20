// Dashboard shell entry point: guards the page, builds the sidebar from
// sections.config.js filtered by the current user's permissions, and
// mounts the hash router into #content.

import { SECTIONS } from './sections.config.js';
import { auth } from './auth.js';
import { renderRoute } from './router.js';
import { contentStore } from './data/contentStore.js';
import { initGlobalLoader, withGlobalLoader, isHeavyRoute } from './loader.js';
import { initHelpTips, helpTipHTML, isHelpDismissed } from './helpTip.js';

// Minimal "?" help layer (see helpTip.js) -- one global listener for every
// tip on every page, installed once here regardless of which section is
// currently mounted.
initHelpTips();

// Top-level await -- native ES module feature, no bundler needed.
const session = await auth.requireSession();
if (session) init(session);

// Single-active-session enforcement (see auth.js) -- every signed-in
// account, students included: a still-open tab keeps its sessionStorage
// cache for its whole lifetime, so it never re-hits requireSession()'s own
// check on its own -- this periodic poll is what actually catches "a newer
// login happened somewhere else, on this same account" while this tab
// just sits here. 25s is frequent enough to feel immediate without
// hammering the DB.
if (session) {
  setInterval(() => { auth.pollActiveSession(); }, 25000);
}

async function init(session) {
  const sidebar = document.getElementById('sidebar');
  const sidebarNav = document.getElementById('sidebarNav');
  const content = document.getElementById('content');
  const appMain = document.querySelector('.app-main');
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const userAvatar = document.getElementById('userAvatar');
  const overlay = document.getElementById('sidebarOverlay');
  const sidebarPeek = document.getElementById('sidebarPeek');
  const sidebarPeekHelp = document.getElementById('sidebarPeekHelp');
  if (sidebarPeekHelp) {
    sidebarPeekHelp.dataset.helpText =
      'זה התפריט הראשי של הכספת. מכאן מנווטים בין האזור האישי, פורטל התוכן, הקורסים והכלים. שים לב: לא כל הסקשנים פעילים לכולם; חלקם ייפתחו לפי הרשאות או בהמשך.';
  }
  const logoutBtn = document.getElementById('logoutBtn');
  const modeToggleBtn = document.getElementById('modeToggleBtn');
  const modeToggleIcon = document.getElementById('modeToggleIcon');
  const modeToggleLabel = document.getElementById('modeToggleLabel');
  const personalGreeting = document.getElementById('personalGreeting');

  initGlobalLoader();

  // The master's own name shows as the "ג'אוריוס" persona everywhere in
  // the dashboard chrome, instead of the real account name -- students
  // still see their own real names, unaffected.
  const displayName = session.role === 'admin' ? "ג'אוריוס" : session.fullName || session.username || 'משתמש';
  userName.textContent = displayName;
  userRole.textContent = session.role === 'admin' ? 'מאסטר המערכת' : 'משתמש';
  userAvatar.textContent = displayName.charAt(0).toUpperCase();
  personalGreeting.textContent = 'איזור אישי';

  // alwaysVisibleLocked sections (currently just ליווי אישי) always show
  // in the sidebar regardless of permission -- the section itself gates
  // real content behind a "locked" placeholder (see
  // personalGuidanceSection.js / router.js's carve-out for this one id).
  const visibleSections = SECTIONS.filter(
    (s) => session.role === 'admin' || session.permissions[s.id] || s.alwaysVisibleLocked
  );

  function navItemHTML(id, label, icon) {
    return `<a class="nav-item" data-id="${id}" href="#/${id}">
      <span class="nav-label">${label}</span>
    </a>`;
  }

  // Section labels can be renamed inline (edit mode) via contentStore's
  // `sections` table -- blend that over the static config so a rename shows
  // up here too, not just on the pages that display it directly.
  async function buildNav() {
    const records = await contentStore.sections.getAll();
    const titleById = new Map(records.map((r) => [r.id, r.title]));
    sidebarNav.innerHTML = visibleSections
      .map((s) => navItemHTML(s.id, titleById.get(s.id) || s.label, s.icon))
      .join('');
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
      modeToggleLabel.textContent = editMode ? 'לחץ לכיבוי עריכה' : 'לחץ למצב עריכה';
      modeToggleBtn.title = editMode ? 'לחיצה לכיבוי מצב עריכה' : 'לחיצה למעבר למצב עריכה';
    }

    renderModeToggle();

    modeToggleBtn.addEventListener('click', async () => {
      const switchingToUserMode = auth.isEditMode();
      auth.setViewMode(switchingToUserMode ? 'user' : 'edit');
      renderModeToggle();
      if (switchingToUserMode && window.location.hash.startsWith('#/admin')) {
        window.location.hash = '#/';
      } else {
        await handleRoute();
      }
    });
  }

  function setActive(activeId) {
    sidebar.querySelectorAll('.nav-item').forEach((el) => {
      const isActive = el.dataset.id === activeId;
      el.classList.toggle('active', isActive);
      el.classList.toggle('active-section-diamond', isActive);
    });
    // Lets dashboard.css re-tint a whole section's wall/glow/borders via
    // the existing hue-rotate hooks (see --wall-hue-shift, --content-hue-
    // shift) -- purely a CSS scoping attribute, no new theme mechanism.
    appMain.dataset.activeSection = activeId || '';
    // Same attribute mirrored onto <body> so the sidebar brand chrome
    // (outside .app-main) can also react to the active section.
    document.body.dataset.activeSection = activeId || '';
  }

  function isMobile() {
    return window.innerWidth <= 900;
  }

  // The diamond's own true aspect ratio (see .active-section-diamond in
  // dashboard.css). The active row fills its width with the diamond, so
  // its rendered width and the diamond's are effectively the same; the
  // ratio is kept as a safety net in case the row's box ever differs.
  const DIAMOND_RATIO = 640 / 170;

  // Mobile + sidebar closed: a sliver of the active section's own diamond
  // peeks in from the right edge, at the same height that diamond sits at
  // when the sidebar is open, and doubles as the open button. Its position
  // is read straight from the real active nav-item's rendered box
  // (getBoundingClientRect), so it stays accurate even while the sidebar
  // itself is translated off-screen, since that transform only shifts X.
  function updatePeek() {
    if (!isMobile() || document.body.classList.contains('sidebar-open')) {
      sidebarPeek.hidden = true;
      if (sidebarPeekHelp) sidebarPeekHelp.hidden = true;
      return;
    }
    const activeItem = sidebar.querySelector('.nav-item.active');
    if (!activeItem) {
      sidebarPeek.hidden = true;
      if (sidebarPeekHelp) sidebarPeekHelp.hidden = true;
      return;
    }
    const rect = activeItem.getBoundingClientRect();
    const diamondHeight = rect.height;
    const diamondWidth = diamondHeight * DIAMOND_RATIO;
    const visible = Math.max(18, Math.round(diamondWidth * 0.13));
    sidebarPeek.style.top = `${Math.round(rect.top)}px`;
    sidebarPeek.style.width = `${Math.round(diamondWidth)}px`;
    sidebarPeek.style.height = `${Math.round(diamondHeight)}px`;
    sidebarPeek.style.right = `${-(Math.round(diamondWidth) - visible)}px`;
    sidebarPeek.hidden = false;

    // Floats just above-left of the visible sliver -- close enough to read
    // as "about that", never overlapping the diamond itself or blocking the
    // tap target. Skipped entirely (not just hidden) once dismissed, per
    // helpTipHTML's own convention elsewhere.
    if (sidebarPeekHelp) {
      if (isHelpDismissed('sidebar-menu')) {
        sidebarPeekHelp.hidden = true;
      } else {
        sidebarPeekHelp.style.top = `${Math.round(rect.top - 22)}px`;
        sidebarPeekHelp.style.right = '6px';
        sidebarPeekHelp.hidden = false;
      }
    }
  }

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    updatePeek();
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    updatePeek();
  }

  // `renderRoute` resolves permissions/lesson lookups over the network
  // before the target page's own mount function ever runs -- the two
  // lines below give instant feedback the moment a click/hashchange
  // fires, entirely from information already known client-side (the hash
  // itself): the sidebar highlight jumps to the clicked section right
  // away, and the sidebar closes on mobile right away. `setActive` runs
  // again once the real route resolves, correcting anything the
  // optimistic guess got wrong (e.g. access denied) -- it was never the
  // sole source of truth.
  //
  // The shared loader (js/loader.js) is deliberately NOT wired to every
  // navigation -- most of the app is already fast/responsive without it.
  // It's only wrapped around routes isHeavyRoute() flags as genuinely
  // heavy (today: opening a lesson, which loads its video/embed + full
  // data set); every other route (section homes, personal area, admin
  // tools, ...) navigates exactly as before, no loader involved at all.
  function activeIdFromHash(hash) {
    const first = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)[0];
    return first || 'me';
  }

  async function handleRoute() {
    setActive(activeIdFromHash(window.location.hash));
    if (isMobile()) closeSidebar();
    const hash = window.location.hash;
    const result = isHeavyRoute(hash)
      ? await withGlobalLoader(() => renderRoute(content, hash))
      : await renderRoute(content, hash);
    setActive(result.activeId);
    content.scrollTop = 0;
    // Refreshes nav labels (a section title may have just been renamed
    // in edit mode) in the background -- never blocks the click-to-
    // content responsiveness above on a second network round trip.
    buildNav().then(() => setActive(result.activeId));
    updatePeek();
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  sidebarPeek.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => {
    if (!isMobile()) openSidebar();
    updatePeek();
  });

  if (!isMobile()) openSidebar();

  logoutBtn.addEventListener('click', async () => {
    await auth.logout();
    window.location.href = 'login.html';
  });
}
