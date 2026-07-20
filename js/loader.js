// The ONE shared loading component for the whole app (replaces every
// page's own "טוען..." text placeholder -- see the mount functions this
// used to be duplicated into). A small vault-lock motif: a faint outer
// ring, two slow counter-orbiting energy arcs, a central cross "handle"
// turning steadily, and a soft two-tone breathing sapphire glow -- pure
// SVG + CSS, no external image (per the "לא להשתמש עדיין בתמונה חיצונית"
// requirement).
//
// This is intentionally NOT a blanket "loading state for everything"
// component: it is only ever wired to a short, explicit whitelist of
// genuinely heavy operations (see isHeavyRoute() below, used by
// dashboard.js) -- normal navigation, accordions, popups, toggles and
// quick admin actions all stay exactly as fast/instant as they already
// were, with no loader involved at all.
//
// Timing rule (createLoaderTimer): the loader never shows at all for a
// fetch that resolves within SHOW_DELAY_MS (avoids the "flash for an
// instant" bug), and once it DOES show, it stays up for a short minimum
// beat (MIN_VISIBLE_MS) just long enough to avoid a flicker -- SHORT on
// purpose, so it disappears the moment real content is ready instead of
// lingering on screen over content that's already loaded.

const SHOW_DELAY_MS = 250;
const MIN_VISIBLE_MS = 320;
const FADE_MS = 200;

// Whitelist: the loader is wired ONLY to routes that genuinely load heavy
// content (a lesson's video/embed + its full data set) -- every other
// route (section homes, personal area, admin tools, ...) navigates with
// no loader at all, per the "ברירת מחדל: לא להציג" requirement. A route
// counts as heavy simply if it has a '/lesson/' segment, which covers
// every lesson-viewing path in the app (vault/freedom/personalGuidance's
// own lesson routes, and the generic contentViewer's course/.../lesson
// route) without needing a per-section list to keep in sync.
export function isHeavyRoute(hash) {
  const path = (hash || '').replace(/^#\/?/, '');
  const parts = path.split('/').filter(Boolean);
  return parts.includes('lesson');
}

export function loaderMarkup(size = 'page') {
  return `
    <div class="vault-loader vault-loader-${size}" role="status" aria-label="טוען">
      <svg class="vault-loader-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="vault-loader-ring" cx="50" cy="50" r="40"></circle>
        <circle class="vault-loader-arc" cx="50" cy="50" r="40"></circle>
        <circle class="vault-loader-arc-inner" cx="50" cy="50" r="31"></circle>
        <g class="vault-loader-ticks">
          <line x1="50" y1="6" x2="50" y2="14"></line>
          <line x1="50" y1="86" x2="50" y2="94"></line>
          <line x1="6" y1="50" x2="14" y2="50"></line>
          <line x1="86" y1="50" x2="94" y2="50"></line>
        </g>
        <g class="vault-loader-handle">
          <line x1="50" y1="27" x2="50" y2="73"></line>
          <line x1="27" y1="50" x2="73" y2="50"></line>
          <circle class="vault-loader-hub" cx="50" cy="50" r="8"></circle>
        </g>
      </svg>
    </div>`;
}

// Shared debounce/min-visible-time controller -- `show`/`hide` are plain
// callbacks the caller supplies (DOM mutations only), this function owns
// only the timing.
function createLoaderTimer({ show, hide, showDelay = SHOW_DELAY_MS, minVisible = MIN_VISIBLE_MS }) {
  let showTimer = null;
  let shownAt = null;

  function start() {
    showTimer = setTimeout(() => {
      showTimer = null;
      shownAt = Date.now();
      show();
    }, showDelay);
  }

  async function finish() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (shownAt !== null) {
      const elapsed = Date.now() - shownAt;
      if (elapsed < minVisible) {
        await new Promise((resolve) => setTimeout(resolve, minVisible - elapsed));
      }
      shownAt = null;
      hide();
    }
  }

  return { start, finish };
}

// --- Global overlay (one static element, see dashboard.html) -----------

let overlayEl = null;
let overlayHideTimeout = null;

export function initGlobalLoader() {
  overlayEl = document.getElementById('contentLoaderOverlay');
  if (overlayEl && !overlayEl.dataset.ready) {
    overlayEl.innerHTML = loaderMarkup('page');
    overlayEl.dataset.ready = '1';
  }
}

function showGlobalLoader() {
  if (!overlayEl) return;
  if (overlayHideTimeout) {
    clearTimeout(overlayHideTimeout);
    overlayHideTimeout = null;
  }
  overlayEl.hidden = false;
  // Forces a style flush so the opacity transition below actually plays
  // (toggling [hidden] and a class in the same tick would otherwise
  // collapse into one paint with no transition).
  void overlayEl.offsetWidth;
  overlayEl.classList.add('is-visible');
}

function hideGlobalLoader() {
  if (!overlayEl) return;
  overlayEl.classList.remove('is-visible');
  overlayHideTimeout = setTimeout(() => {
    if (overlayEl) overlayEl.hidden = true;
  }, FADE_MS);
}

// Wraps one real navigation's async work (route resolution + the target
// page's own data fetch) -- shows the shared overlay only if it takes
// longer than SHOW_DELAY_MS, keeps it up for at least MIN_VISIBLE_MS once
// shown, fades in/out either way. `task` may throw; the loader is always
// cleaned up via finally, and the error is rethrown untouched.
export async function withGlobalLoader(task) {
  const timer = createLoaderTimer({ show: showGlobalLoader, hide: hideGlobalLoader });
  timer.start();
  try {
    return await task();
  } finally {
    await timer.finish();
  }
}

// --- Scoped loader (injected into any one container) -------------------

// Same timing rules, but the loader is painted directly into `container`
// instead of a shared overlay -- for a real fetch that happens AFTER a
// page already mounted (e.g. opening one student's folder/history modal).
// The caller is expected to overwrite `container.innerHTML` with the real
// content immediately after this resolves -- this never hides itself,
// since there's nothing to fade back to underneath it.
export async function withScopedLoader(container, task, { size = 'modal' } = {}) {
  const timer = createLoaderTimer({
    show: () => {
      container.innerHTML = loaderMarkup(size);
    },
    hide: () => {},
  });
  timer.start();
  try {
    return await task();
  } finally {
    await timer.finish();
  }
}
