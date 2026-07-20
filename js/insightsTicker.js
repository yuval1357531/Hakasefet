// Shared engine for the top "insights ticker" that runs in both the הכספת
// and מהישרדות לחופש sections (they were byte-identical before; this is the
// single place that logic now lives). Owns three things:
//   1. buildTickerItems / tickerHTML -- what phrases a given viewer sees.
//   2. wireTicker -- the seamless, drag-interactive running marquee.
//   3. highlightsManagerHTML / wireHighlightsManager -- the master-only
//      editor (text + per-lesson links, added one dropdown at a time +
//      depth level + edit/delete on existing phrases).
// Each section passes in its own store + lessons; nothing here is
// section-specific.

import { helpTipHTML } from './helpTip.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

// Decides which phrases a viewer actually sees:
//   - showInTicker === false always excludes a phrase from the main ticker,
//     no matter what -- this is what keeps "צידה לדרך" (per-lesson notes,
//     see trailNotesForLesson below) from leaking into the top strip: a
//     trail note only reaches the ticker if the master explicitly opted it
//     in via "להציג גם בצג הראשי" (see wireTrailManager). Phrases created
//     from the general ticker manager (wireHighlightsManager) always carry
//     showInTicker: true, so this never affects them.
//   - master in edit mode: every other active phrase (nothing is locked
//     away).
//   - student: a phrase with no lesson links is general (always shown); a
//     phrase linked to lessons unlocks once they've completed at least one
//     of those lessons.
// Approved community comments are never gated -- they trail the phrases.
export function buildTickerItems({ highlights, comments, completedIds, editMode }) {
  const set = completedIds instanceof Set ? completedIds : new Set(completedIds || []);
  const visibleHighlights = (highlights || []).filter((h) => {
    if (h.showInTicker === false) return false;
    if (editMode) return true;
    const links = h.linkedLessonIds || [];
    if (links.length === 0) return true;
    return links.some((id) => set.has(id));
  });
  return [
    ...visibleHighlights.map((h) => escapeHtml(h.text)),
    ...(comments || []).map((c) => `${escapeHtml(c.displayName)}: ${escapeHtml(c.text)}`),
  ];
}

export function tickerHTML(items) {
  if (!items || items.length === 0) {
    return '<div class="insights-empty">עדיין אין משפטים או תגובות מאושרות להצגה</div>';
  }
  // The small ג'אוריוס mask icon (same logo as the "שלום ג'אוריוס"
  // personal-area link) is the separator between phrases -- replacing the
  // old plain "✦" star. Appended after EVERY item (including the last)
  // rather than joined between them, so the same one-separator rhythm
  // continues seamlessly across the loop seam where one cloned
  // .insights-ticker-set meets the next (see wireTicker/fill()) -- never
  // a double separator, never a bare gap with none at all.
  const sep = '<span class="insights-sep" aria-hidden="true"><img src="assets/jaurius-mask-icon-64.png" alt=""></span>';
  const set = items.map((t) => `<span class="insights-item">${t}</span>${sep}`).join('');
  return `
    <div class="insights-ticker" data-insights-ticker>
      <div class="insights-ticker-track" data-insights-track>
        <div class="insights-ticker-set">${set}</div>
      </div>
    </div>`;
}

// Turns the static markup above into a living marquee. Driven by a plain,
// heavily-guarded requestAnimationFrame loop -- NOT a CSS animation. Two
// real, separate bugs were found and fixed across earlier attempts at this
// (a NaN-corrupting zero-width race, and a CSS animation-shorthand race
// with an implicit `duration: 0s`); this version is deliberately the
// simplest possible mechanism, with defensive guards that make BOTH of
// those failure classes structurally impossible:
//   - `offset` is clamped back to a finite number every single frame, so
//     even if a measurement is ever momentarily invalid, motion resumes
//     the very next frame instead of freezing forever.
//   - `dt` (the per-frame time delta) is clamped, so a tab that was
//     backgrounded/throttled for a while doesn't jump the strip.
//   - a resize/remeasure never resets `offset` -- it only re-wraps the
//     SAME persistent value into the newly-measured loop length, so the
//     strip never appears to "restart" (this is what mobile browsers'
//     resize-on-scroll, from the address bar hiding, was doing before).
//
// `direction: ltr` is force-set on the ticker in CSS: the page itself is
// RTL (<html dir="rtl">), and `display:flex` under RTL lays out children
// in *reverse* by spec -- an ambiguity this component has no reason to
// depend on. Isolating the strip to LTR makes "first phrase enters the
// window first, motion runs one consistent physical direction" a
// certainty instead of an assumption. Each phrase's own Hebrew text still
// renders correctly (right letter order) because that's the Unicode
// bidi algorithm operating within the run, independent of the
// container's base direction -- see the `.insights-item` rule in
// dashboard.css, which asserts `direction: rtl` back for exactly that.
export function wireTicker(root) {
  const ticker = root.querySelector('[data-insights-ticker]');
  if (!ticker) return;
  const track = ticker.querySelector('[data-insights-track]');
  const firstSet = track && track.querySelector('.insights-ticker-set');
  if (!track || !firstSet) return;

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEED = 46; // px/sec -- the normal, cruising autoplay speed
  // How quickly a post-release velocity relaxes back to -SPEED (seconds).
  // One exponential-decay formula produces both feels the spec asks for:
  // a hard fling keeps coasting near its release speed for a beat, then
  // eases down to cruise ("flywheel/dreidel"); a soft release (near-zero
  // velocity) relaxes to cruise almost immediately.
  const MOMENTUM_TAU = 0.65;

  let oneLoop = 0; // width of ONE phrase-set repetition, in px
  let offset = 0; // px, always kept in (-oneLoop, 0]
  let velocity = -SPEED; // px/sec, signed -- current motion, drifts toward -SPEED every frame
  let dragging = false;
  let rafId = null;
  let lastTs = 0;

  // Clones the phrase-set enough times that the track comfortably
  // exceeds two screens' worth of content -- so however few phrases
  // exist, there's never a blank stretch, and wrapping by exactly
  // `oneLoop` is always seamless (repetition N+1 is pixel-identical to
  // repetition N).
  function fill() {
    while (track.children.length > 1) track.removeChild(track.lastChild);
    const w = firstSet.offsetWidth;
    if (!isFinite(w) || w <= 0) return false;
    const need = (ticker.offsetWidth || w) * 2 + w;
    let total = w;
    while (total < need) {
      track.appendChild(firstSet.cloneNode(true));
      total += w;
    }
    oneLoop = w;
    return true;
  }

  function normalize() {
    if (!(oneLoop > 0) || !isFinite(offset)) { offset = 0; return; }
    offset = offset % oneLoop;
    if (offset > 0) offset -= oneLoop;
  }

  function apply() {
    if (!isFinite(offset)) offset = 0; // self-healing: never persist a bad value
    track.style.transform = `translate3d(${offset}px,0,0)`;
  }

  function tick(ts) {
    if (!document.contains(ticker)) { rafId = null; return; }
    if (dragging || reduce) { lastTs = ts; rafId = requestAnimationFrame(tick); return; }
    if (!lastTs) lastTs = ts;
    const dt = Math.min(Math.max((ts - lastTs) / 1000, 0), 0.1); // clamp: guards a backgrounded-tab time jump
    lastTs = ts;
    if (oneLoop > 0) {
      // Relax `velocity` toward the cruise speed (-SPEED) every frame. A
      // fast release keeps most of its speed at first and eases down; a
      // near-zero release relaxes to cruise almost at once -- either way
      // it always ends up at the same steady autoplay speed, and the
      // offset/normalize/apply pipeline below never changes, so the loop
      // stays seamless and infinite regardless of velocity.
      if (!isFinite(velocity)) velocity = -SPEED;
      const relax = 1 - Math.exp(-dt / MOMENTUM_TAU);
      velocity += (-SPEED - velocity) * relax;
      offset += velocity * dt;
      normalize();
      apply();
    }
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (rafId != null) return;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function remeasure() {
    if (!document.contains(ticker)) { window.removeEventListener('resize', remeasure); return; }
    if (dragging) return;
    fill();
    normalize(); // re-wraps the SAME offset into the new length -- never resets to 0
    apply();
  }
  window.addEventListener('resize', remeasure);

  const ok = fill();
  if (!ok) setTimeout(remeasure, 200); // layout wasn't ready yet (rare) -- retry once
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure).catch(() => {});
  apply();
  start();

  if (reduce) return;

  // --- drag / scrub ---------------------------------------------------
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let startX = 0;
  let startOffset = 0;
  let pointerId = null;
  // Rolling ~100ms window of {t, x} pointer samples taken while dragging,
  // used to estimate the release velocity for the momentum/inertia handoff
  // -- a "flick" and a "gentle let-go" need to feel different, and the
  // only way to tell them apart is the finger's actual recent speed.
  // Raw clientX (not `offset`) on purpose: `offset` gets wrapped by
  // normalize() whenever a drag crosses a loop boundary, which would
  // otherwise look like a huge, bogus velocity spike.
  let dragSamples = [];

  ticker.addEventListener('pointerdown', (e) => {
    if (!(oneLoop > 0)) return;
    dragging = true;
    startX = e.clientX;
    startOffset = offset;
    pointerId = e.pointerId;
    dragSamples = [{ t: now(), x: e.clientX }];
    ticker.classList.add('is-dragging');
    try { ticker.setPointerCapture(e.pointerId); } catch (_) {}
  });

  ticker.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    offset = startOffset + (e.clientX - startX);
    normalize();
    apply();
    const t = now();
    dragSamples.push({ t, x: e.clientX });
    while (dragSamples.length > 2 && t - dragSamples[0].t > 100) dragSamples.shift();
    e.preventDefault();
  });

  function releaseVelocity() {
    if (dragSamples.length < 2) return 0;
    const first = dragSamples[0];
    const last = dragSamples[dragSamples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (!(dt > 0)) return 0;
    const v = (last.x - first.x) / dt;
    return isFinite(v) ? v : 0;
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    ticker.classList.remove('is-dragging');
    try { if (pointerId != null) ticker.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null;
    lastTs = 0;
    // Seed the momentum system with how fast the finger was actually
    // moving at release -- a hard flick keeps coasting, a soft release
    // relaxes to cruise almost immediately (both handled by the single
    // exponential relax in tick()). Clamped so a wild/erroneous reading
    // can't send the strip spinning unreasonably fast.
    const v = releaseVelocity();
    velocity = isFinite(v) ? Math.max(-4000, Math.min(4000, v)) : -SPEED;
    dragSamples = [];
  }
  ticker.addEventListener('pointerup', endDrag);
  ticker.addEventListener('pointercancel', endDrag);
}

// --- master-only management panel ----------------------------------

// One <select> row for linking a single lesson. `canRemove` puts a small
// remove button on rows added via "+ הוסף קישור לעוד שיעור" (the first row
// stays permanent -- leaving it on "ללא קישור" is how a phrase stays
// general, so there's always at least this one visible, never the full
// lesson list dumped open).
function lessonLinkRowHTML(lessons, selectedId, canRemove) {
  const options = (lessons || [])
    .map((l) => `<option value="${escapeAttr(l.id)}" ${l.id === selectedId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`)
    .join('');
  return `
    <div class="hl-lesson-link-row">
      <select class="hl-lesson-select">
        <option value="">ללא קישור</option>
        ${options}
      </select>
      ${canRemove ? '<button type="button" class="btn-ghost small" data-remove-link title="הסרת קישור">✕</button>' : ''}
    </div>`;
}

export function highlightsManagerHTML({ highlights, lessons, editing }) {
  const isEditing = !!editing;
  const linkedIds = isEditing ? editing.linkedLessonIds || [] : [];
  const rowIds = linkedIds.length ? linkedIds : [null];
  const linkRowsHTML = rowIds.map((id, i) => lessonLinkRowHTML(lessons, id, i > 0)).join('');

  // One simple card per phrase -- readable on mobile without a horizontal
  // scroll, and with only the two actions that matter here (order isn't
  // controllable from this list since phrases just run in the ticker
  // regardless of it; visibility is set from within "עריכה" itself).
  const cards = (highlights || [])
    .map((h) => {
      const linkedNames = (h.linkedLessonIds || [])
        .map((id) => (lessons || []).find((l) => l.id === id))
        .filter(Boolean)
        .map((l) => escapeHtml(l.title));
      const metaLabel =
        linkedNames.length === 0
          ? 'כללי לכולם'
          : linkedNames.length === 1
            ? `מקושר לשיעור: ${linkedNames[0]}`
            : `מקושר לכמה שיעורים: ${linkedNames.join(', ')}`;
      return `
      <div class="hl-card" data-id="${h.id}">
        <p class="hl-card-text">${escapeHtml(h.text)}</p>
        <p class="hl-card-meta">${metaLabel}</p>
        <div class="hl-card-actions">
          <button type="button" class="btn-ghost small" data-hl-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-hl-action="delete">מחיקה</button>
        </div>
      </div>`;
    })
    .join('');

  return `
    <form id="highlightForm" novalidate>
      <div class="field-group">
        <label for="hlText">${isEditing ? 'עריכת המשפט' : 'משפט או ציטוט חדש'}</label>
        <input type="text" id="hlText" placeholder="לדוגמה: כל יום שאתה מתמיד הוא ניצחון" value="${isEditing ? escapeAttr(editing.text) : ''}">
      </div>
      <div class="field-group">
        <label>קישור לשיעור <span class="muted-note">(לא חובה — קובע רק מתי המשפט ייפתח בפס אחרי שהתלמיד יסמן שצפה בשיעור; ריק = משפט כללי, מוצג לכולם תמיד)</span></label>
        <div id="hlLessonLinks" class="hl-lesson-links">${linkRowsHTML}</div>
        <button type="button" class="btn-ghost small" id="hlAddLessonLink">+ הוסף קישור לעוד שיעור</button>
      </div>
      <label class="focus-important-toggle">
        <input type="checkbox" id="hlIsActive" ${(!isEditing || editing.isActive !== false) ? 'checked' : ''}> להציג בפס המשפטים
      </label>
      <div class="form-actions">
        <button type="submit" class="btn-gold">${isEditing ? 'שמירת שינויים' : 'הוספת משפט'}</button>
        ${isEditing ? '<button type="button" class="btn-ghost" id="hlCancelEdit">ביטול</button>' : ''}
      </div>
    </form>
    <div class="hl-card-list">${cards || '<p class="placeholder-desc">אין עדיין משפטים.</p>'}</div>`;
}

// --- "צידה לדרך" -- the same highlight phrases, scoped to ONE lesson ----
// Not a second system: it's the identical `highlights` table/store the
// ticker reads, just filtered down to whichever phrases are linked to a
// single lesson id. A phrase created here is a completely normal highlight
// row with `linkedLessonIds: [thisLessonId]`, but -- unlike a phrase added
// from the general ticker manager -- it does NOT reach the main ticker on
// its own: `showInTicker` defaults to false here (see trailManagerHTML's
// "להציג גם בצג הראשי" checkbox), and buildTickerItems above hard-excludes
// anything with showInTicker === false regardless of lesson-completion
// state. Trail notes always show in this lesson's own "צידה לדרך" block no
// matter what that flag is -- trailNotesForLesson never filters on it.

export function trailNotesForLesson(highlights, lessonId) {
  return (highlights || []).filter((h) => (h.linkedLessonIds || []).includes(lessonId));
}

function trailMediaKind(mediaUrl) {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(mediaUrl)) return 'video';
  if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(mediaUrl)) return 'image';
  return 'file';
}

// A trail note's optional media (image/video/file) is uploaded by the
// master (see trailManagerHTML/wireTrailManager below) to the public
// 'trail-media' storage bucket and stored as a plain public URL -- same
// lightweight rendering contract as a lesson's own embedUrl, so this
// function itself needs no upload/storage awareness.
//
// Renders as a small, fixed-size clickable thumbnail (never a full-width
// block -- the sentence stays the main content, the thumbnail sits beside
// it) with a small expand badge; the actual full-size view only appears
// when clicked, via the shared lightbox (see wireTrailExpand below). A
// silent, controls-less <video> is enough to show a first-frame thumbnail
// without needing a separate poster-image pipeline.
export function trailMediaHTML(mediaUrl) {
  if (!mediaUrl) return '';
  const kind = trailMediaKind(mediaUrl);
  const inner =
    kind === 'image'
      ? `<img src="${escapeAttr(mediaUrl)}" alt="">`
      : kind === 'video'
        ? `<video src="${escapeAttr(mediaUrl)}" muted preload="metadata"></video><span class="trail-media-thumb-icon">▶</span>`
        : `<span class="trail-media-thumb-icon">📎</span>`;
  return `
    <button type="button" class="trail-media-thumb" data-media-url="${escapeAttr(mediaUrl)}" data-media-kind="${kind}" aria-label="הגדלת המדיה">
      ${inner}
      <span class="trail-media-expand-icon" aria-hidden="true">⤢</span>
    </button>`;
}

const TRAIL_TEXT_LIMIT = 140;

// Long trail-note/journal sentences are truncated with a "הצגת הכל" link
// instead of letting the card grow to fit -- the full text opens in the
// same lightbox the media thumbnail uses (see wireTrailExpand), matching
// the "opens on screen like a notification, closes back" behaviour for
// both. The full text is kept in a hidden sibling (not a data-attribute)
// so reading it back never needs a second escaping/unescaping step.
export function trailTextHTML(text, className = 'trail-note-text') {
  const value = text || '';
  const safe = escapeHtml(value);
  if (value.length <= TRAIL_TEXT_LIMIT) return `<p class="${className}">${safe}</p>`;
  const truncated = escapeHtml(value.slice(0, TRAIL_TEXT_LIMIT).trim()) + '…';
  return `
    <p class="${className}">${truncated}</p>
    <button type="button" class="trail-text-more" data-trail-text-expand>הצגת הכל</button>
    <span class="trail-text-full" hidden>${safe}</span>`;
}

// --- shared lightbox: one singleton overlay per page, reused by every
// media thumbnail / "הצגת הכל" button across לדרך צידה, both lesson pages
// and the personal journal (see wireTrailExpand). Lazily created on first
// use so pages that never render a trail note never pay for it. ---------
let trailLightboxEl = null;

function ensureTrailLightbox() {
  if (trailLightboxEl && document.body.contains(trailLightboxEl)) return trailLightboxEl;
  trailLightboxEl = document.createElement('div');
  trailLightboxEl.className = 'trail-lightbox-overlay';
  trailLightboxEl.hidden = true;
  trailLightboxEl.innerHTML = `
    <div class="trail-lightbox-box">
      <button type="button" class="trail-lightbox-close" aria-label="סגירה">✕</button>
      <div class="trail-lightbox-content"></div>
    </div>`;
  trailLightboxEl.addEventListener('click', (e) => {
    if (e.target === trailLightboxEl) closeTrailLightbox();
  });
  trailLightboxEl.querySelector('.trail-lightbox-close').addEventListener('click', closeTrailLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trailLightboxEl && !trailLightboxEl.hidden) closeTrailLightbox();
  });
  document.body.appendChild(trailLightboxEl);
  return trailLightboxEl;
}

function closeTrailLightbox() {
  if (!trailLightboxEl) return;
  trailLightboxEl.hidden = true;
  trailLightboxEl.querySelector('.trail-lightbox-content').innerHTML = '';
}

function openTrailLightbox(html) {
  const el = ensureTrailLightbox();
  el.querySelector('.trail-lightbox-content').innerHTML = html;
  el.hidden = false;
}

// Same full-size media markup the media-thumbnail lightbox already builds
// inline (see wireTrailExpand below) -- factored out so the "הצג הכל"
// reveal-all bubble (trailNotesHTML) can reuse it verbatim instead of
// duplicating the image/video/file branches.
function trailMediaFullHTML(url, kind) {
  return kind === 'image'
    ? `<img src="${escapeAttr(url)}" alt="">`
    : kind === 'video'
      ? `<video src="${escapeAttr(url)}" controls autoplay></video>`
      : `<div class="trail-lightbox-file">
          <span class="trail-media-thumb-icon">📎</span>
          <a class="btn-gold" href="${escapeAttr(url)}" target="_blank" rel="noopener">פתיחה בטאב חדש</a>
        </div>`;
}

// Wires every `.trail-media-thumb` (trailMediaHTML), `[data-trail-
// text-expand]` (trailTextHTML) and `[data-trail-reveal-all]` (trailNotesHTML)
// button under `root` to open the shared lightbox. Safe to call on any
// container repeatedly/on every rerender -- listeners live on
// freshly-rendered elements each time, never re-bound to stale nodes. Used
// on lesson pages (student trail notes AND the master's own inline
// preview) and on the personal journal.
export function wireTrailExpand(root) {
  // "יש עוד כלים" -- reveals the rest of the trail-note cards in place
  // (CSS ".is-expanded", see trailNotesHTML) -- a pure local toggle, no
  // rerender, so it never touches saved/journal state.
  root.querySelectorAll('[data-trail-show-more]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.trail-notes')?.classList.add('is-expanded');
    });
  });
  root.querySelectorAll('.trail-media-thumb').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.mediaUrl;
      const kind = btn.dataset.mediaKind;
      openTrailLightbox(trailMediaFullHTML(url, kind));
    });
  });
  root.querySelectorAll('[data-trail-text-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const full = btn.parentElement.querySelector('.trail-text-full')?.textContent || '';
      openTrailLightbox(`<p class="trail-lightbox-text">${escapeHtml(full)}</p>`);
    });
  });
  // "הצג הכל" -- the compact card only ever shows the main sentence + a
  // small media thumbnail; this opens the SAME shared lightbox with all
  // three pieces together (sentence, full-size media, full optional
  // description) -- never the ticker, which never reads description at
  // all (see buildTickerItems above -- unaffected by any of this).
  root.querySelectorAll('[data-trail-reveal-all]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.revealText || '';
      const desc = btn.dataset.revealDesc || '';
      const mediaUrl = btn.dataset.revealMedia || '';
      const mediaKind = btn.dataset.revealMediaKind || '';
      const html = `
        <div class="trail-reveal-all">
          <p class="trail-lightbox-text">${escapeHtml(text)}</p>
          ${mediaUrl ? `<div class="trail-reveal-media">${trailMediaFullHTML(mediaUrl, mediaKind)}</div>` : ''}
          ${desc ? `<p class="trail-reveal-desc">${escapeHtml(desc)}</p>` : ''}
        </div>`;
      openTrailLightbox(html);
    });
  });
}

// Student-facing (and master-preview) display -- deliberately returns ''
// when there's nothing linked, so the caller never renders an empty
// "צידה לדרך" block/heading. `savedKeys` (a Set of "highlightId::lessonId"
// strings, see journalStore.getSavedKeys) marks which items already show
// the "saved to journal" state on their notebook button -- omit it (or
// pass lessonId as '') to render every item as not-yet-saved, e.g. for a
// context with no logged-in student to save against.
export function trailNotesHTML(items, { lessonId = '', savedKeys = null } = {}) {
  if (!items || items.length === 0) return '';
  const cards = items
    .map((h) => {
      const isSaved = !!savedKeys && savedKeys.has(`${h.id}::${lessonId}`);
      // "הצג הכל" -- a plain small link (not another button like "שמירה
      // ליומן"), only shown when there's an optional description to
      // actually reveal; the sentence + media are already visible in the
      // compact card either way.
      const revealAllHTML = h.description
        ? `<button type="button" class="trail-reveal-all-link" data-trail-reveal-all
            data-reveal-text="${escapeAttr(h.text)}" data-reveal-desc="${escapeAttr(h.description)}"
            data-reveal-media="${escapeAttr(h.mediaUrl || '')}" data-reveal-media-kind="${escapeAttr(trailMediaKind(h.mediaUrl || ''))}">הצג הכל</button>`
        : '';
      return `
      <div class="trail-note-item">
        <div class="trail-note-main">
          ${trailTextHTML(h.text)}
          <div class="trail-note-actions">
            <button type="button" class="trail-note-save ${isSaved ? 'is-saved' : ''}"
              data-highlight-id="${escapeAttr(h.id)}" data-lesson-id="${escapeAttr(lessonId)}"
              title="${isSaved ? 'שמור ביומן האישי' : 'שמירה ליומן האישי'}" ${isSaved ? 'disabled' : ''}>
              ${isSaved ? '📓 נשמר ביומן' : '📓 שמירה ליומן'}
            </button>
            ${revealAllHTML}
          </div>
        </div>
        ${trailMediaHTML(h.mediaUrl)}
      </div>`;
    })
    .join('');
  // Compact display: only the first 3 cards show by default (see CSS
  // ":nth-of-type(n+4)") -- a lesson with many saved practices no longer
  // pushes the rest of the page down. "יש עוד כלים" reveals the rest in
  // place (wireTrailExpand), no rerender, no change to what's saved.
  const VISIBLE_COUNT = 3;
  const extraCount = items.length - VISIBLE_COUNT;
  const moreHTML =
    extraCount > 0
      ? `<button type="button" class="trail-notes-more-btn" data-trail-show-more>יש עוד כלים · הצגת ${extraCount} נוספים</button>`
      : '';
  return `
    <div class="panel-card trail-notes">
      <span class="personal-help-row">
        <h3 class="personal-block-title">צידה לדרך</h3>
        ${helpTipHTML('trail-in-lesson', 'צידה לדרך היא נקודת תרגול, פרספקטיבה, טקטיקה או כלי פרקטי מתוך השיעור או בהשראתו. אם משהו תפס אותך או חשוב לך שיהיה זמין, אפשר לשמור אותו, והוא יופיע באזור האישי תחת ״צידה לדרך + הכלים שלי״ כדי לחזור אליו בלי לחפש מחדש בשיעור.')}
      </span>
      <div class="trail-note-list">${cards}</div>
      ${moreHTML}
    </div>`;
}

// Wires the "שמירה ליומן" buttons rendered above. `sectionId` is
// 'vault'|'survivalToFreedom' (needed on the saved row since a highlight
// id is only unique within its own section's table). Confirms before
// saving (per the "לצרף את זה ליומן האישי שלך?" requirement), then
// updates just that one button in place -- no page reload, no full
// re-render of the lesson.
export function wireTrailNotesJournalSave(root, { journalStore, session, sectionId, lessonId }) {
  if (!session) return;
  root.querySelectorAll('.trail-note-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      if (!window.confirm('לצרף את זה ליומן האישי שלך?')) return;
      btn.disabled = true;
      const highlightId = btn.dataset.highlightId;
      const saved = await journalStore.save({ studentId: session.id, sectionId, highlightId, lessonId });
      if (saved) {
        btn.classList.add('is-saved');
        btn.textContent = '📓 נשמר ביומן';
        btn.title = 'שמור ביומן האישי';
      } else {
        btn.disabled = false;
      }
    });
  });
}

// Master-only editor for one lesson's trail notes: add/edit/delete, no
// lesson-link picker at all -- the link is implicit (always this lesson),
// per the "קישור אוטומטי לשיעור הנוכחי" requirement.
export function trailManagerHTML(items, editing) {
  const isEditing = !!editing;
  const rows = (items || [])
    .map(
      (h) => `
      <tr data-id="${h.id}">
        <td>${escapeHtml(h.text)}</td>
        <td class="actions-cell">
          <button type="button" class="btn-ghost small" data-trail-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-trail-action="delete">מחיקה</button>
        </td>
      </tr>`
    )
    .join('');
  // Editing an item that already has media shows it as-is (same compact
  // renderer the student sees) with its own remove control -- picking a
  // NEW file below always takes priority over this on save, so the two
  // never need to be reconciled by hand.
  const existingMediaHTML =
    isEditing && editing.mediaUrl
      ? `<div class="trail-media-existing" id="trailMediaExisting">
          ${trailMediaHTML(editing.mediaUrl)}
          <button type="button" class="trail-media-existing-remove" id="trailMediaRemoveExisting">✕ הסרת המדיה הקיימת</button>
        </div>`
      : '';
  return `
    <form id="trailForm" novalidate>
      <div class="field-group">
        <label for="trailText">${isEditing ? 'עריכת המשפט' : 'משפט / תובנה / פרקטיקה / תזכורת לשיעור זה'}</label>
        <input type="text" id="trailText" placeholder="תובנה, פרקטיקה או תזכורת לשיעור..." value="${isEditing ? escapeAttr(editing.text) : ''}">
      </div>
      <div class="field-group">
        <label>מדיה (אופציונלי) <span class="muted-note">(תמונה, סרטון קצר או קובץ)</span></label>
        ${existingMediaHTML}
        <div class="trail-media-picker">
          <button type="button" class="btn-ghost small" id="trailMediaAddBtn">+ הוסף מדיה</button>
          <input type="file" id="trailMediaInput" hidden>
          <p class="trail-media-selected" id="trailMediaSelected" hidden></p>
        </div>
      </div>
      <div class="field-group" id="trailDescGroup" ${isEditing && editing.description ? '' : 'hidden'}>
        <label for="trailDescription">תיאור (אופציונלי)</label>
        <textarea id="trailDescription" rows="2" placeholder="תיאור מורחב, יוצג רק ב&quot;הצג הכל&quot;...">${isEditing ? escapeHtml(editing.description || '') : ''}</textarea>
      </div>
      <button type="button" class="btn-ghost small" id="trailAddDescBtn" ${isEditing && editing.description ? 'hidden' : ''}>+ הוסף תיאור</button>
      <label class="focus-important-toggle">
        <input type="checkbox" id="trailShowInTicker" ${isEditing && editing.showInTicker ? 'checked' : ''}> להציג גם בצג הראשי
      </label>
      <div class="form-actions">
        <button type="submit" class="btn-gold">${isEditing ? 'שמירת שינויים' : 'הוספה'}</button>
        ${isEditing ? '<button type="button" class="btn-ghost" id="trailCancelEdit">ביטול</button>' : ''}
      </div>
    </form>
    <div class="table-scroll">
      <table class="users-table">
        <thead><tr><th>טקסט</th><th>פעולות</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2">אין עדיין משפטים לשיעור זה.</td></tr>'}</tbody>
      </table>
    </div>`;
}

// `lessonId` is the CURRENT lesson -- always folded into linkedLessonIds
// on create, and preserved (never stripped) on update, even though this
// mini-editor doesn't expose a lesson picker of its own.
//
// `highlights` is the CALLER's own full local array (the same one the
// general ticker manager reads) -- this function patches it in place
// after each successful store call instead of triggering a network
// refetch, so `rerender` can be a pure, local, synchronous repaint. That
// is what makes every action here instant with no page-reload feel, per
// the master-actions-stay-in-page requirement.
export function wireTrailManager(root, { store, lessonId, highlights, rerender, getEditingId, setEditingId }) {
  const form = root.querySelector('#trailForm');
  if (!form) return;

  function patch(id, updated) {
    if (!updated) return;
    const idx = highlights.findIndex((h) => h.id === id);
    if (idx !== -1) highlights[idx] = updated;
  }

  // --- media picker: "+ הוסף מדיה" clicks straight into the real OS
  // upload picker (native <input type=file>, no accept restriction and no
  // in-between menu of our own -- the browser's own sheet already offers
  // gallery/camera/files together). The chosen File lives only in this
  // closure until submit uploads it; a fresh wireTrailManager call (every
  // rerender) always starts clean, so there's no stale-file risk across
  // edits/cancels. ------------------------------------------------------
  let selectedFile = null;
  let clearExistingMedia = false;

  const addBtn = root.querySelector('#trailMediaAddBtn');
  const input = root.querySelector('#trailMediaInput');
  const selectedLabel = root.querySelector('#trailMediaSelected');
  const kindIcon = { image: '🖼', video: '🎬', file: '📎' };

  function showSelected(file) {
    if (!selectedLabel) return;
    if (!file) {
      selectedLabel.hidden = true;
      selectedLabel.innerHTML = '';
      return;
    }
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
    selectedLabel.hidden = false;
    selectedLabel.innerHTML = `${kindIcon[kind]} ${escapeHtml(file.name)} <button type="button" id="trailMediaClearSelected">✕</button>`;
    const clearBtn = selectedLabel.querySelector('#trailMediaClearSelected');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        selectedFile = null;
        if (input) input.value = '';
        showSelected(null);
      });
    }
  }

  if (addBtn && input) {
    addBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      selectedFile = file;
      clearExistingMedia = false;
      const existing = root.querySelector('#trailMediaExisting');
      if (existing) existing.remove();
      showSelected(file);
    });
  }
  // "+ הוסף תיאור" -- reveals the optional description field in place (no
  // rerender needed, same plain show/hide the media picker above uses);
  // once shown it just stays visible for the rest of this edit/create pass.
  const addDescBtn = root.querySelector('#trailAddDescBtn');
  const descGroup = root.querySelector('#trailDescGroup');
  if (addDescBtn && descGroup) {
    addDescBtn.addEventListener('click', () => {
      descGroup.hidden = false;
      addDescBtn.hidden = true;
      root.querySelector('#trailDescription')?.focus();
    });
  }

  wireTrailExpand(root);
  const removeExistingBtn = root.querySelector('#trailMediaRemoveExisting');
  if (removeExistingBtn) {
    removeExistingBtn.addEventListener('click', () => {
      clearExistingMedia = true;
      selectedFile = null;
      root.querySelector('#trailMediaExisting')?.remove();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = root.querySelector('#trailText').value.trim();
    if (!text) return;
    // Defaults to false (unchecked) -- a trail note stays inside this
    // lesson's own "צידה לדרך" unless the master explicitly opts it into
    // the main ticker too, per the "לא אמור להיכנס אוטומטית" requirement.
    const showInTicker = root.querySelector('#trailShowInTicker').checked;
    // Optional -- only ever read if the master actually revealed the field
    // (see #trailAddDescBtn above); never sent to the top ticker either
    // way (buildTickerItems only ever reads `.text`).
    const descField = root.querySelector('#trailDescription');
    const description = descField && !descField.closest('#trailDescGroup').hidden ? descField.value.trim() : '';
    const mediaChanges = selectedFile ? { file: selectedFile } : clearExistingMedia ? { mediaUrl: '' } : {};
    const editingId = getEditingId();
    if (editingId) {
      const current = highlights.find((h) => h.id === editingId);
      const linkedLessonIds = Array.from(new Set([...(current?.linkedLessonIds || []), lessonId]));
      const updated = await store.highlights.update(editingId, { text, linkedLessonIds, showInTicker, description, ...mediaChanges });
      patch(editingId, updated);
      setEditingId(null);
    } else {
      const created = await store.highlights.create({ text, linkedLessonIds: [lessonId], showInTicker, description, ...mediaChanges });
      if (created) highlights.push(created);
    }
    await rerender();
  });

  const cancel = root.querySelector('#trailCancelEdit');
  if (cancel) {
    cancel.addEventListener('click', async () => {
      setEditingId(null);
      await rerender();
    });
  }

  root.querySelectorAll('[data-trail-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const action = btn.dataset.trailAction;
      if (action === 'edit') {
        setEditingId(id);
        await rerender();
        return;
      }
      if (action === 'delete') {
        if (!window.confirm('למחוק את המשפט?')) return;
        await store.highlights.remove(id);
        const idx = highlights.findIndex((h) => h.id === id);
        if (idx !== -1) highlights.splice(idx, 1);
        if (getEditingId() === id) setEditingId(null);
      }
      await rerender();
    });
  });
}

// `store` is the section store (vaultStore / freedomStore); only its
// `.highlights` API is touched. `lessons` is needed to build any dropdown
// row added at runtime via "+ הוסף קישור לעוד שיעור". `highlights` is the
// caller's own full local array, patched in place after each successful
// store call so `rerender` can be a pure local repaint -- see the note on
// wireTrailManager above; the two share the exact same pattern since both
// manage rows in the same underlying table. editing state lives in the
// caller's render closure and is read/written through
// getEditingId / setEditingId.
export function wireHighlightsManager(root, { store, lessons, highlights, rerender, getEditingId, setEditingId }) {
  const form = root.querySelector('#highlightForm');
  if (!form) return;

  const linksContainer = root.querySelector('#hlLessonLinks');
  const addLinkBtn = root.querySelector('#hlAddLessonLink');
  if (addLinkBtn) {
    addLinkBtn.addEventListener('click', () => {
      const wrap = document.createElement('div');
      wrap.innerHTML = lessonLinkRowHTML(lessons, null, true);
      linksContainer.appendChild(wrap.firstElementChild);
    });
  }
  if (linksContainer) {
    linksContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-link]');
      if (!btn) return;
      btn.closest('.hl-lesson-link-row').remove();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = root.querySelector('#hlText').value.trim();
    if (!text) return;
    const linkedLessonIds = Array.from(root.querySelectorAll('.hl-lesson-select'))
      .map((s) => s.value)
      .filter(Boolean);
    const isActive = root.querySelector('#hlIsActive').checked;
    const editingId = getEditingId();
    if (editingId) {
      const updated = await store.highlights.update(editingId, { text, linkedLessonIds, isActive });
      if (updated) {
        const idx = highlights.findIndex((h) => h.id === editingId);
        if (idx !== -1) highlights[idx] = updated;
      }
      setEditingId(null);
    } else {
      const created = await store.highlights.create({ text, linkedLessonIds, isActive });
      if (created) highlights.push(created);
    }
    await rerender();
  });

  const cancel = root.querySelector('#hlCancelEdit');
  if (cancel) {
    cancel.addEventListener('click', async () => {
      setEditingId(null);
      await rerender();
    });
  }

  root.querySelectorAll('[data-hl-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.hl-card').dataset.id;
      const action = btn.dataset.hlAction;
      if (action === 'edit') {
        setEditingId(id);
        await rerender();
        return;
      }
      if (action === 'delete') {
        if (!window.confirm('למחוק את המשפט?')) return;
        await store.highlights.remove(id);
        const idx = highlights.findIndex((h) => h.id === id);
        if (idx !== -1) highlights.splice(idx, 1);
        if (getEditingId() === id) setEditingId(null);
      }
      await rerender();
    });
  });
}
