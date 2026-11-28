// Battery care for decorative motion. Two rules, both invisible to the user:
//  1. A decorative muted clip (the 3D fire, the lesson ice) plays only while
//     it is on screen.
//  2. While one of the windows people stay in is open (FOCUS_WINDOWS), all the
//     decorative motion behind it is held (clips here, CSS loops through
//     body.focus-hold in dashboard.css) and resumes when it closes.
// Nothing here touches lesson players, sound, navigation or content.

const FOCUS_WINDOWS = '#streakOverlay, #boardOverlay, #trailOverlay, .trail-lightbox-overlay, .burn-intro, .burn-moment';

const clips = new Set();
const offScreen = new WeakSet();
let holding = false;

function apply(v) {
  const run = !offScreen.has(v) && !(holding && !v.closest('[data-focus]'));
  if (run && v.paused) v.play().catch(() => {});
  else if (!run && !v.paused) v.pause();
}

const io = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) offScreen.delete(e.target);
        else offScreen.add(e.target);
        if (e.target.isConnected) apply(e.target);
      });
    }, { rootMargin: '80px' })
  : null;

// Registers a clip that should loop; starts it right away.
export function watchClip(v) {
  clips.forEach((c) => {
    if (c.isConnected) return;
    clips.delete(c);
    if (io) io.unobserve(c);
  });
  if (!clips.has(v)) {
    clips.add(v);
    if (io) io.observe(v);
  }
  apply(v);
}

function sync() {
  let open = false;
  document.querySelectorAll(FOCUS_WINDOWS).forEach((el) => {
    el.toggleAttribute('data-focus', !el.hidden);
    if (!el.hidden) open = true;
  });
  if (open === holding) return;
  holding = open;
  document.body.classList.toggle('focus-hold', open);
  clips.forEach((v) => { if (v.isConnected) apply(v); });
}

// The windows open and close by their own `hidden` attribute, and the page
// content is replaced whole on navigation / repaint. Watching just those two
// keeps every window's own code untouched and can never leave the page on hold.
export function initFocusMode(content) {
  if (typeof MutationObserver !== 'function') return;
  const mo = new MutationObserver(sync);
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  const pageMo = new MutationObserver(sync);
  pageMo.observe(content, { childList: true });
  pageMo.observe(document.body, { childList: true });
  sync();
}
