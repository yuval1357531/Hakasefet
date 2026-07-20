// "אזור אישי — חוויית משתמש" -- master-only preview of the personal area
// exactly as a regular user would see it, using the SAME engine
// (personalArea.js's studentPageHTML) with a demo id that matches no real
// profile -- every query naturally returns an empty result (RLS still
// allows the read since the caller is admin), so this never touches the
// master's own account and never creates a real user, per the "רק תצוגת
// preview" requirement.

import { studentPageHTML, wireAttachmentLinks } from './personalArea.js';
import { wireTrailExpand } from '../insightsTicker.js';

// The nil UUID -- syntactically valid, guaranteed to match no real
// profiles row, so every store call below just comes back empty.
const DEMO_SESSION = {
  id: '00000000-0000-0000-0000-000000000000',
  fullName: 'תלמיד לדוגמה',
  username: 'demo',
  role: 'user',
  permissions: {},
};

export async function mountPersonalAreaPreview(container) {
  const { html } = await studentPageHTML(DEMO_SESSION, { boardModalOpen: false, trailModalOpen: false });
  container.innerHTML = `
    <div class="admin-preview-banner">תצוגה מקדימה — כך נראה האזור האישי אצל משתמש רגיל (ללא נתונים אמיתיים)</div>
    ${html}`;

  // Only the pure, non-mutating UI interactions are wired here (popup
  // open/close, media lightbox) -- writing/marking-done are intentionally
  // left inert, per the "לצפייה בלבד" preview scope (they'd also just
  // fail silently either way: the demo id matches no real profile row).
  const boardBtn = container.querySelector('#boardOpenBtn');
  const boardOverlay = container.querySelector('#boardOverlay');
  if (boardBtn && boardOverlay) {
    boardBtn.addEventListener('click', () => {
      boardOverlay.hidden = false;
    });
    const closeBoard = () => {
      boardOverlay.hidden = true;
    };
    container.querySelector('#boardClose')?.addEventListener('click', closeBoard);
    boardOverlay.addEventListener('click', (e) => {
      if (e.target === boardOverlay) closeBoard();
    });
  }
  const trailBtn = container.querySelector('#trailToolsOpenBtn');
  const trailOverlay = container.querySelector('#trailOverlay');
  if (trailBtn && trailOverlay) {
    trailBtn.addEventListener('click', () => {
      trailOverlay.hidden = false;
    });
    const closeTrail = () => {
      trailOverlay.hidden = true;
    };
    container.querySelector('#trailClose')?.addEventListener('click', closeTrail);
    trailOverlay.addEventListener('click', (e) => {
      if (e.target === trailOverlay) closeTrail();
    });
  }
  wireAttachmentLinks(container);
  wireTrailExpand(container);

  // The daily-wheel handle is left disabled here -- same "לצפייה בלבד"
  // reasoning as the notebook/mark-done controls above: spinning it would
  // both mutate nothing real (the demo id matches no profile row) and, if
  // wired, still shouldn't consume the master's own daily spin.
  const wheelHandle = container.querySelector('#dailyWheelHandle');
  if (wheelHandle) wheelHandle.disabled = true;
}
