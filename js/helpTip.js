// Minimal, reusable "?" help-tip component. Deliberately NOT an onboarding
// system: no tour, no forced first-run popup, no video -- just a tiny,
// quiet "?" next to specific existing elements that opens a short
// explanation on click, dismissible forever via "אל תציג שוב".
//
// One global, delegated click listener (installed once from dashboard.js
// via initHelpTips()) handles every tip on every page, however many times
// that page's own module re-renders its container -- callers only ever
// need to emit helpTipHTML(id, text) in their template string; nothing to
// wire per-page.

const DISMISS_KEY_PREFIX = 'vault_help_dismissed_';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

export function isHelpDismissed(id) {
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + id) === '1';
  } catch (e) {
    return false;
  }
}

function dismiss(id) {
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + id, '1');
  } catch (e) {
    /* best-effort -- worst case the tip just keeps showing */
  }
}

// `id` is a short, stable, unique-per-explanation slug -- doubles as the
// localStorage dismiss-key and the data attribute the global click
// listener reads the explanation text from. Returns '' once dismissed, so
// callers can just splice this straight into their template string with no
// extra branching of their own.
export function helpTipHTML(id, text) {
  if (isHelpDismissed(id)) return '';
  return `<button type="button" class="help-tip" data-help-id="${id}" data-help-text="${escapeAttr(text)}" aria-label="הסבר" aria-haspopup="dialog">?</button>`;
}

let openOverlay = null;

function closeBubble() {
  if (openOverlay) {
    openOverlay.remove();
    openOverlay = null;
  }
}

function openBubble(trigger) {
  closeBubble();
  const id = trigger.dataset.helpId;
  // `.dataset` gives back the attribute's already HTML-decoded value (so
  // any `<`/`>` that were literally part of the text come back un-escaped)
  // -- this is a DIFFERENT rendering context (HTML body) than the
  // attribute context helpTipHTML's own escapeAttr protects, so it needs
  // its own escaping here before going into innerHTML.
  const text = escapeHtml(trigger.dataset.helpText);

  const overlay = document.createElement('div');
  overlay.className = 'help-tip-overlay';
  overlay.innerHTML = `
    <div class="help-tip-bubble" role="dialog" aria-label="הסבר">
      <p class="help-tip-text">${text}</p>
      <div class="help-tip-actions">
        <button type="button" class="help-tip-dismiss">אל תציג שוב</button>
        <button type="button" class="help-tip-close">סגור</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  openOverlay = overlay;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBubble();
  });
  overlay.querySelector('.help-tip-close').addEventListener('click', closeBubble);
  overlay.querySelector('.help-tip-dismiss').addEventListener('click', () => {
    dismiss(id);
    trigger.remove(); // this specific "?" disappears immediately too, not just next visit
    closeBubble();
  });
}

// Call exactly once (dashboard.js does this at startup).
export function initHelpTips() {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.help-tip');
    if (trigger) openBubble(trigger);
  });
}
