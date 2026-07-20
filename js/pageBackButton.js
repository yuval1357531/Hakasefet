// Small "X"/back affordance for lesson pages (vault/freedom/personalGuidance).
// Previously router.js prepended this once as a raw DOM node right after
// the initial mount (see prependBackButton there, still used for admin
// tools/course pages) -- but a lesson page's OWN paint() re-renders
// container.innerHTML from scratch on almost every action (watched toggle,
// comment submit, accordion open, inline edit save, ...), which wiped that
// prepended node out along with everything else. Baking the button into
// the page's own template string instead means it's rebuilt every time
// paint() runs, so it can never silently disappear.
export function backButtonHTML() {
  return `<button type="button" class="page-back-btn" data-page-back aria-label="חזרה">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}

export function wirePageBackButton(root) {
  root.querySelectorAll('[data-page-back]').forEach((btn) => {
    btn.addEventListener('click', () => window.history.back());
  });
}
