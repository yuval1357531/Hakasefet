// The daily-wheel widget on the student's personal-area page -- a small,
// premium interactive element (a crystal reel + pull-handle) that reveals
// one sentence from its own separate bank (dailyWheelStore.js) once every
// 24 hours. Entirely self-contained: it fetches its own data and manages
// its own spin animation via direct DOM mutation, independent of
// personalArea.js's own render() cycle -- the same pattern insightsTicker.js's
// wireTicker already uses for the top ticker's marquee, so this widget
// re-mounting from scratch on personalArea.js's other re-renders (notebook
// save, mark task done) is cheap and never conflicts with it.
//
// Also exports the tiny master-only sentence manager (dailyWheelManagerHTML
// / wireDailyWheelManager) used inside personalArea.js's "ניהול משפטים
// לרכיב היומי" accordion -- plain text CRUD, no lesson links, no depth
// levels, per the "לא צריך רמת עומק" scope.

import { dailyWheelStore } from './data/dailyWheelStore.js';
import { progressStore } from './data/progressStore.js';
import { vaultStore } from './data/vaultStore.js';

const LOCK_MS = 24 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

// "23:49" -- a plain HH:MM countdown, not a sentence. Minute-resolution
// (matches the once-a-minute refresh below) rounded UP so the display
// never reads "00:00" while there's still a few seconds of lock left.
function timeLeftDigits(msLeft) {
  const totalMinutes = Math.max(0, Math.ceil(msLeft / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Flip-clock readout "HH:MM:SS" as an array of digit characters -- seconds
// resolution so the last digit visibly flips every second while the drawer
// is open (the closed tab still shows the plain HH:MM from timeLeftDigits).
function clockDigits(msLeft) {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join('').split('');
}

function flipDigitHTML(d) {
  return `<span class="fc-digit" data-d="${d}"><span class="fc-half fc-top"><i>${d}</i></span><span class="fc-half fc-bot"><i>${d}</i></span><span class="fc-half fc-flap-top"><i>${d}</i></span><span class="fc-half fc-flap-bot"><i>${d}</i></span></span>`;
}

function flipClockHTML(digits) {
  const d = digits;
  return `${flipDigitHTML(d[0])}${flipDigitHTML(d[1])}<span class="fc-sep">:</span>${flipDigitHTML(d[2])}${flipDigitHTML(d[3])}<span class="fc-sep">:</span>${flipDigitHTML(d[4])}${flipDigitHTML(d[5])}`;
}

// Split-flap change of one digit: the top half folds down showing the old
// digit while the new one is already underneath, then the bottom half
// settles in. No-op when the digit is unchanged.
function setFlipDigit(el, next, animate = true) {
  const prev = el.dataset.d;
  if (prev === next) return;
  el.dataset.d = next;
  const set = (cls, v) => {
    el.querySelector(cls + ' i').textContent = v;
  };
  if (!animate) {
    ['.fc-top', '.fc-bot', '.fc-flap-top', '.fc-flap-bot'].forEach((c) => set(c, next));
    el.classList.remove('is-flipping');
    return;
  }
  set('.fc-top', next);
  set('.fc-flap-top', prev);
  set('.fc-flap-bot', next);
  set('.fc-bot', prev);
  el.classList.remove('is-flipping');
  void el.offsetWidth;
  el.classList.add('is-flipping');
  clearTimeout(el._fcTimer);
  el._fcTimer = setTimeout(() => {
    set('.fc-bot', next);
    el.classList.remove('is-flipping');
  }, 620);
}

// Which topics this student has been watching lately (the lessons they
// opened most recently, mapped through the הכספת topics) -- used to lean
// the next sentence toward what they're actually working on. Matching is by
// keyword on the topic's name, so renaming a topic slightly never breaks it.
const TOPIC_KEYWORDS = {
  women: ['נשים', 'משיכה'],
  sexuality: ['מיני', 'יצרים'],
  presence: ['נוכחות', 'תקשורת', 'פריים'],
  confidence: ['ביטחון', 'ערך עצמי'],
  anxiety: ['חרדה', 'סטרס'],
  healing: ['ריפוי', 'טראומ'],
  wealth: ['עושר', 'שמחה'],
  reality: ['מציאות'],
  energy: ['אנרגי', "צ'קר"],
  spirit: ['רוחני', 'תודעה'],
  masculinity: ['גבריות', 'זכרי'],
};

async function favoriteTopicKeys(userId) {
  try {
    const [progress, topics] = await Promise.all([progressStore.getForUser(userId), vaultStore.topics.getAll()]);
    const recent = progress
      .filter((p) => p.lastWatchedAt)
      .sort((a, b) => new Date(b.lastWatchedAt) - new Date(a.lastWatchedAt))
      .slice(0, 10);
    if (!recent.length) return [];
    const counts = {};
    for (const key of Object.keys(TOPIC_KEYWORDS)) {
      const matching = topics.filter((t) => TOPIC_KEYWORDS[key].some((kw) => t.name.includes(kw)));
      const lessonIds = new Set(matching.flatMap((t) => t.linkedLessonIds || []));
      counts[key] = recent.filter((p) => lessonIds.has(p.lessonId)).length;
    }
    return Object.keys(counts)
      .filter((k) => counts[k] > 0)
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 2);
  } catch (e) {
    return [];
  }
}

// Never the same sentence twice until the whole bank has been seen; and
// when we know what the student has been watching, about 6 times in 10 the
// pick comes from a matching topic (the rest stays varied on purpose).
// Returns { final, seenIds }.
function pickSentence(sentences, seenIds, favoriteKeys) {
  let seen = new Set(seenIds || []);
  let pool = sentences.filter((s) => !seen.has(s.id));
  if (!pool.length) {
    seen = new Set();
    pool = sentences;
  }
  let candidates = pool;
  if (favoriteKeys.length && Math.random() < 0.6) {
    const matching = pool.filter((s) => s.topic && favoriteKeys.includes(s.topic));
    if (matching.length) candidates = matching;
  }
  const final = candidates[Math.floor(Math.random() * candidates.length)];
  seen.add(final.id);
  return { final, seenIds: Array.from(seen) };
}

// Deliberately no title/label text on the widget itself -- understood
// through its shape (glass reel + handle), per the "בלי שם וטקסטים
// מיותרים" requirement. The idle state shows a small diamond mark instead
// of any word.
export function dailyWheelHTML() {
  return `
    <div class="daily-wheel" id="dailyWheel">
      <div class="daily-wheel-row">
        <button type="button" class="daily-wheel-handle" id="dailyWheelHandle" aria-label="הפעלת המנגנון" title="הפעלה">
          <span class="daily-wheel-handle-grip" aria-hidden="true"></span>
        </button>
        <div class="daily-wheel-glass">
          <div class="daily-wheel-reel" id="dailyWheelReel"><span class="daily-wheel-orb" aria-hidden="true">◆</span></div>
        </div>
      </div>
      <div class="daily-wheel-timer" id="dailyWheelTimer" hidden>
        <svg class="daily-wheel-timer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 2h12M6 22h12M8 2c0 4 3 5 4 6 1-1 4-2 4-6M8 22c0-4 3-5 4-6 1 1 4 2 4 6"/>
        </svg>
        <span class="daily-wheel-timer-value flip-clock" id="dailyWheelTimerValue" dir="ltr">${flipClockHTML(clockDigits(0))}</span>
      </div>
    </div>`;
}

// Mounts fresh every time it's called -- fetches its own sentence bank +
// spin state, so the caller never needs to pass either in. Safe to call
// repeatedly on a freshly-rendered #dailyWheel node (every personalArea.js
// render() creates a brand new one).
//
// `onLockChange(display)` is an optional, purely additive hook -- called
// every time the lock countdown updates, with either the "HH:MM" string
// while locked or `null` once unlocked. Doesn't change any timing/reveal
// logic itself; it just lets a caller mirror the same countdown onto some
// OTHER element (personalArea.js's own closed-drawer tab) without
// duplicating the 24h lock computation.
//
// `options.demoSpin` (master's student-view preview only): pretend this
// student already spun a while ago, so the locked state + flip clock can be
// seen without touching any real spin row.
export async function mountDailyWheel(root, session, onLockChange, options = {}) {
  if (!root) return;
  const reel = root.querySelector('#dailyWheelReel');
  const handle = root.querySelector('#dailyWheelHandle');
  const timerEl = root.querySelector('#dailyWheelTimer');
  const timerValueEl = root.querySelector('#dailyWheelTimerValue');
  if (!reel || !handle || !timerEl || !timerValueEl) return;

  const [sentences, realSpin] = await Promise.all([
    dailyWheelStore.sentences.getAll(),
    options.demoSpin ? Promise.resolve(null) : dailyWheelStore.getMySpin(session.id),
  ]);
  const spin = options.demoSpin
    ? {
        sentenceId: null,
        sentenceText: (sentences[0] && sentences[0].text) || '',
        spunAt: new Date(Date.now() - LOCK_MS + 20 * 3600000 + 14 * 60000 + 37000).toISOString(),
        seenIds: [],
      }
    : realSpin;

  let lockInterval = null;
  let seenSoFar = spin ? [...spin.seenIds, spin.sentenceId] : [];
  let suppressFlip = true; // first paint sets the digits without flipping

  function showRevealed(text) {
    reel.innerHTML = `<span class="daily-wheel-sentence">${escapeHtml(text)}</span>`;
    root.classList.remove('is-revealed');
    // Force a reflow before re-adding the class so the "lock-in" glow
    // (@keyframes daily-wheel-lock, triggered by .is-revealed appearing)
    // replays on every single spin, not just the first.
    void root.offsetWidth;
    root.classList.add('is-revealed');
  }

  function updateLockUI(spunAt) {
    const msLeft = new Date(spunAt).getTime() + LOCK_MS - Date.now();
    if (msLeft <= 0) {
      root.classList.remove('is-locked');
      handle.disabled = false;
      timerEl.hidden = true;
      if (lockInterval) {
        clearInterval(lockInterval);
        lockInterval = null;
      }
      if (onLockChange) onLockChange(null);
      return;
    }
    root.classList.add('is-locked');
    handle.disabled = true;
    timerEl.hidden = false;
    const digits = clockDigits(msLeft);
    const digitEls = timerValueEl.querySelectorAll('.fc-digit');
    digitEls.forEach((el, i) => setFlipDigit(el, digits[i], !suppressFlip));
    if (onLockChange) onLockChange(timeLeftDigits(msLeft));
  }

  // When the drawer opens, every digit rolls from 0 up to the real value
  // (the "clock winds up" moment) -- then it ticks normally each second.
  // Fired by personalArea.js's wireWheelDrawer on the #dailyWheel node.
  root.addEventListener('wheeldrawer:open', () => {
    if (!root.classList.contains('is-locked')) return;
    const digitEls = timerValueEl.querySelectorAll('.fc-digit');
    const target = Array.from(digitEls).map((el) => el.dataset.d);
    digitEls.forEach((el) => setFlipDigit(el, '0', false));
    target.forEach((d, i) => setTimeout(() => setFlipDigit(digitEls[i], d, true), 140 + i * 70));
  });

  if (spin) {
    reel.innerHTML = `<span class="daily-wheel-sentence">${escapeHtml(spin.sentenceText)}</span>`;
    root.classList.add('is-revealed');
    updateLockUI(spin.spunAt);
    suppressFlip = false;
    if (root.classList.contains('is-locked')) {
      lockInterval = setInterval(() => updateLockUI(spin.spunAt), 1000);
    }
  } else {
    suppressFlip = false;
    if (onLockChange) onLockChange(null); // never spun yet -- available right now.
  }

  // Instant, direct press feedback (item 4) -- pointerdown/up rather than
  // relying solely on CSS :active, so the response is identical on mobile
  // touch and desktop mouse alike, and can be layered with the handle's
  // own richer glow/depth classes below.
  handle.addEventListener('pointerdown', () => {
    if (!handle.disabled) root.classList.add('is-pressed');
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
    handle.addEventListener(evt, () => root.classList.remove('is-pressed'));
  });

  if (!sentences.length) {
    handle.disabled = true;
    return;
  }

  handle.addEventListener('click', () => {
    if (handle.disabled || root.classList.contains('is-spinning')) return;
    root.classList.add('is-spinning');
    root.classList.remove('is-revealed');
    handle.disabled = true;

    // Resolved while the reel is already cycling below -- by the time the
    // animation settles (~1.5s) the pick is long done.
    const pickPromise = favoriteTopicKeys(session.id).then((keys) => pickSentence(sentences, seenSoFar, keys));
    const cycleEl = document.createElement('span');
    cycleEl.className = 'daily-wheel-sentence daily-wheel-cycling';
    reel.innerHTML = '';
    reel.appendChild(cycleEl);

    // Ease-out cycling -- fast at first, settling toward the reveal,
    // matching the site's own "weight, never an abrupt snap" language
    // rather than a flat constant-speed flicker. Each tick also restarts
    // a short "flip" keyframe (daily-wheel-tick, CSS) by toggling
    // animation off/on across a forced reflow, so every swapped line
    // visibly slides/settles into place like a real mechanical reel
    // instead of just replacing text.
    const delays = [70, 70, 75, 80, 90, 100, 115, 130, 150, 175, 205, 240];
    let i = 0;
    function tick() {
      const s = sentences[Math.floor(Math.random() * sentences.length)];
      cycleEl.textContent = s.text;
      cycleEl.style.animation = 'none';
      void cycleEl.offsetWidth;
      cycleEl.style.animation = '';
      i += 1;
      if (i < delays.length) {
        setTimeout(tick, delays[i]);
        return;
      }
      pickPromise.then(({ final, seenIds }) => {
        root.classList.remove('is-spinning');
        showRevealed(final.text);
        seenSoFar = seenIds;
        dailyWheelStore.spin({ userId: session.id, sentenceId: final.id, sentenceText: final.text, seenIds }).then((saved) => {
          if (!saved) return;
          suppressFlip = true;
          updateLockUI(saved.spunAt);
          suppressFlip = false;
          if (lockInterval) clearInterval(lockInterval);
          lockInterval = setInterval(() => updateLockUI(saved.spunAt), 1000);
        });
      });
    }
    tick();
  });
}

// --- master-only: "ניהול משפטים לרכיב היומי" -----------------------------
//
// The add/edit form stays directly inside the accordion (unchanged); the
// full sentence LIST used to render right below it too -- with 20+
// sentences that dragged the whole personal-area page down. It now lives
// behind a "משפטים קיימים" trigger that opens a small modal (same
// personal-modal-overlay shell used everywhere else in the app) with its
// own internal scroll, so the page itself never grows because of how many
// sentences exist.

export function dailyWheelManagerHTML({ sentences, editing }) {
  const isEditing = !!editing;
  const count = (sentences || []).length;
  return `
    <form id="dailyWheelSentenceForm" novalidate>
      <div class="field-group">
        <label for="dailyWheelSentenceInput">${isEditing ? 'עריכת משפט' : 'משפט חדש לרכיב היומי'}</label>
        <input type="text" id="dailyWheelSentenceInput" placeholder="משפט קצר..." value="${isEditing ? escapeAttr(editing.text) : ''}">
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-gold small">${isEditing ? 'שמירת שינויים' : 'הוספה'}</button>
        ${isEditing ? '<button type="button" class="btn-ghost small" id="dailyWheelCancelEdit">ביטול</button>' : ''}
      </div>
    </form>
    <button type="button" class="btn-ghost small compact-list-open-btn" id="dailyWheelSentencesOpenBtn">
      משפטים קיימים${count ? `<span class="admin-badge admin-badge-neutral">${count}</span>` : ''}
    </button>`;
}

// Separate from the accordion body so it can render as a modal overlay
// (personalArea.js appends this once, as a page-level sibling, same as
// the other popups there).
export function dailyWheelSentencesModalHTML(sentences, isOpen) {
  const rows = (sentences || [])
    .map(
      (s) => `
      <div class="hl-card" data-id="${s.id}">
        <p class="hl-card-text">${escapeHtml(s.text)}</p>
        <div class="hl-card-actions">
          <button type="button" class="btn-ghost small" data-wheel-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-wheel-action="delete">מחיקה</button>
        </div>
      </div>`
    )
    .join('');
  return `
    <div class="personal-modal-overlay" id="dailyWheelSentencesOverlay" ${isOpen ? '' : 'hidden'}>
      <div class="personal-modal-card panel-card">
        <div class="personal-modal-header">
          <h3 class="personal-block-title">משפטים קיימים</h3>
          <button type="button" class="personal-modal-close" id="dailyWheelSentencesClose" aria-label="סגירה">✕</button>
        </div>
        <div class="personal-modal-body">
          <div class="hl-card-list">${rows || '<p class="placeholder-desc">אין עדיין משפטים.</p>'}</div>
        </div>
      </div>
    </div>`;
}

// `sentences` is the caller's own local array, patched in place -- same
// reasoning as wireHighlightsManager in insightsTicker.js: `rerender` can
// stay a pure, local, synchronous repaint with no network refetch.
export function wireDailyWheelManager(root, { sentences, rerender, getEditingId, setEditingId }) {
  const form = root.querySelector('#dailyWheelSentenceForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = root.querySelector('#dailyWheelSentenceInput');
    const text = input.value.trim();
    if (!text) return;
    const editingId = getEditingId();
    if (editingId) {
      const updated = await dailyWheelStore.sentences.update(editingId, text);
      if (updated) {
        const idx = sentences.findIndex((s) => s.id === editingId);
        if (idx !== -1) sentences[idx] = updated;
      }
      setEditingId(null);
    } else {
      const created = await dailyWheelStore.sentences.create(text);
      if (created) sentences.push(created);
    }
    await rerender();
  });

  const cancel = root.querySelector('#dailyWheelCancelEdit');
  if (cancel) {
    cancel.addEventListener('click', async () => {
      setEditingId(null);
      await rerender();
    });
  }
}

// Wires the "משפטים קיימים" trigger + its modal (open/close, edit,
// delete). `setOpen`/`isOpen` are the caller's own closure state (same
// pattern as personalArea.js's other modals) so the open/closed state
// survives an unrelated render() elsewhere on the page. Editing a
// sentence closes the modal -- the form it populates lives in the
// accordion behind it, not inside the modal itself.
export function wireDailyWheelSentencesModal(root, { sentences, rerender, getEditingId, setEditingId, setOpen }) {
  const openBtn = root.querySelector('#dailyWheelSentencesOpenBtn');
  const overlay = root.querySelector('#dailyWheelSentencesOverlay');
  if (openBtn && overlay) {
    openBtn.addEventListener('click', () => {
      setOpen(true);
      overlay.hidden = false;
    });
    const close = () => {
      setOpen(false);
      overlay.hidden = true;
    };
    root.querySelector('#dailyWheelSentencesClose')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  root.querySelectorAll('[data-wheel-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-id]').dataset.id;
      const action = btn.dataset.wheelAction;
      if (action === 'edit') {
        setEditingId(id);
        setOpen(false);
        if (overlay) overlay.hidden = true;
        await rerender();
        return;
      }
      if (action === 'delete') {
        if (!window.confirm('למחוק את המשפט?')) return;
        await dailyWheelStore.sentences.remove(id);
        const idx = sentences.findIndex((s) => s.id === id);
        if (idx !== -1) sentences.splice(idx, 1);
      }
      await rerender();
    });
  });
}
