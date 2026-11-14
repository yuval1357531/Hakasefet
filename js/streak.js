// "הרצף" -- the student-facing login streak. A small button on the personal
// page shows the current count; pressing it opens a popup with the road to
// the master-defined gifts: one vertical rail that fills with the same
// living "blue fire" the progress bars use (.progress-bar-fill), a node per
// gift along it, and a "you are here" marker at the streak's position.
// Entirely self-contained like dailyWheel.js: pure HTML builders plus a
// mount function that talks to streakStore, so personalArea.js only has to
// drop the button/popup markup in and call mountStreak().
//
// Also exports the small master-only gifts manager used inside
// personalArea.js's "ניהול מתנות הרצף" accordion.

import { streakStore } from './data/streakStore.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

const ICONS = {
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2c1 4-3 5.5-3 9.5a3.5 3.5 0 0 0 7 0c0-1.2-.4-2-1-3 2.2 1 4 3.4 4 6.2A7 7 0 0 1 5 14.7C5 9.5 10 8 12 2z"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
  meeting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 14.8c1.8.7 3 2.3 3 5.2"/></svg>',
  course: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M7 10.5V16c0 1.4 2.2 3 5 3s5-1.6 5-3v-5.5"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

export const REWARD_ICON_OPTIONS = [
  { value: 'gift', label: 'מתנה' },
  { value: 'meeting', label: 'פגישה' },
  { value: 'course', label: 'קורס' },
];

function rewardIcon(reward) {
  return ICONS[reward.icon] || ICONS.gift;
}

function daysWord(n) {
  return n === 1 ? 'יום' : 'ימים';
}

// --- the flame --------------------------------------------------------------
// Same flame silhouette as ICONS.flame, filled in three nested layers (outer /
// mid / core) so it can flicker. It "grows" with the streak (continuous scale
// up to day 60) and changes form at fixed stages: 0 ember, 1-4 spark, 5-9
// blue, 10-29 big blue with rising sparks, 30-59 gold, 60+ royal white-blue.
const FLAME_PATH = 'M12 2c1 4-3 5.5-3 9.5a3.5 3.5 0 0 0 7 0c0-1.2-.4-2-1-3 2.2 1 4 3.4 4 6.2A7 7 0 0 1 5 14.7C5 9.5 10 8 12 2z';

export function flameStage(n) {
  return n >= 60 ? 5 : n >= 30 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : n >= 1 ? 1 : 0;
}

export function flameHTML(streak, extraClass = '') {
  const stage = flameStage(streak);
  const grow = streak <= 0 ? 0.5 : streak >= 60 ? 1.08 : 0.62 + (0.38 * streak) / 60;
  const sparkCount = stage >= 5 ? 5 : stage >= 3 ? 3 : 0;
  const sparks = Array.from({ length: sparkCount }, (_, i) => `<i class="flame-spark" style="--i:${i}"></i>`).join('');
  return `<span class="flame flame-s${stage} ${extraClass}" style="--grow:${grow.toFixed(3)}" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="flame-outer" d="${FLAME_PATH}"/><path class="flame-mid" d="${FLAME_PATH}"/><path class="flame-core" d="${FLAME_PATH}"/></svg>${sparks}</span>`;
}

// --- the 3D fire -------------------------------------------------------------
// The fire is a small set of pre-rendered 12s loops (tools/flame ->
// assets/flame/flame-*.mp4: fire on pure black, screen-blended on the page)
// and each streak day COMPOSES one from the ladder below: a base clip, a
// size, a glow, an optional hue turn (the orange first flashes become cold
// blue), an optional travelling colour wave (a hue-shifted copy revealed by
// a band that sweeps up the flame) and an optional gold tint. Size and glow
// grow smoothly between ladder rows, so it changes every day; the clip /
// wave / gold change at the rows. The fire stays blue throughout.
//   d: first day, c: clip, s: size, g: glow, h: hue turn (deg),
//   w: colour-wave level 0-1, gold: gold tint 0-1
const FIRE_LADDER = [
  { d: 0, c: '0', s: 0.9, g: 0.1 },
  { d: 1, c: '1', s: 0.9, g: 0.15, h: 190 },
  { d: 2, c: '2', s: 0.95, g: 0.2, h: 190 },
  { d: 3, c: '3', s: 1, g: 0.25, h: 190 },
  { d: 5, c: '10', s: 0.55, g: 0.25 },
  { d: 7, c: '10', s: 0.68, g: 0.35 },
  { d: 10, c: '10', s: 0.8, g: 0.45 },
  { d: 15, c: '15', s: 0.88, g: 0.5 },
  { d: 20, c: '20', s: 0.92, g: 0.55 },
  { d: 25, c: '25', s: 0.96, g: 0.6 },
  { d: 30, c: '50', s: 0.96, g: 0.65, w: 0.3 },
  { d: 35, c: '50', s: 1, g: 0.7, w: 0.4 },
  { d: 40, c: 'crown', s: 1, g: 0.75, w: 0.5 },
  { d: 45, c: 'vortex', s: 1, g: 0.8, w: 0.6 },
  { d: 50, c: 'vortex', s: 1.03, g: 0.85, w: 0.8, gold: 0.3 },
  { d: 55, c: 'crown', s: 1.05, g: 0.9, w: 0.9, gold: 0.4 },
  { d: 60, c: '60', s: 1.06, g: 0.95, w: 0.6 },
  { d: 70, c: 'ultimate', s: 1.12, g: 1, w: 1, gold: 0.5 },
];

export function fireStageIndex(streak) {
  let i = 0;
  FIRE_LADDER.forEach((r, k) => { if (r.d <= streak) i = k; });
  return i;
}

export function fireHTML(streak, extraClass = '') {
  const i = fireStageIndex(streak);
  const row = FIRE_LADDER[i];
  const next = FIRE_LADDER[i + 1];
  const t = next ? Math.min(1, Math.max(0, (streak - row.d) / (next.d - row.d))) : 0;
  const lerp = (x, y) => x + (y - x) * t;
  const s = next && next.c === row.c ? lerp(row.s, next.s) : row.s;
  const g = next ? lerp(row.g, next.g) : row.g;
  const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base = 'assets/flame/flame-' + row.c;
  const play = still ? '' : 'autoplay ';
  const hue = row.h ? 'filter:hue-rotate(' + row.h + 'deg);' : '';
  const sc = 'scale:' + s.toFixed(3) + ';';
  let html = '<video style="' + sc + hue + '" src="' + base + '.mp4" poster="' + base + '.webp" ' + play + 'loop muted playsinline preload="metadata"></video>';
  if (row.w && !still) {
    const rare = row.w < 0.45;
    const wa = Math.min(1, 0.45 + row.w * 0.6).toFixed(2);
    const wd = rare ? 40 : (22 - row.w * 10).toFixed(1);
    html += '<video class="fire-wave' + (rare ? ' is-rare' : '') + '" aria-hidden="true" style="' + sc + '--wa:' + wa + ';--wd:' + wd + 's" src="' + base + '.mp4" ' + play + 'loop muted playsinline preload="metadata"></video>';
  }
  if (row.gold && !still) {
    html += '<video class="fire-gold" aria-hidden="true" style="' + sc + '--ga:' + row.gold + '" src="' + base + '.mp4" ' + play + 'loop muted playsinline preload="metadata"></video>';
  }
  return '<span class="fire3d ' + extraClass + '" data-fire-clip="' + row.c + '" style="--fg:' + g.toFixed(2) + '" aria-hidden="true">' + html + '</span>';
}

// Videos inserted through innerHTML don't always start on their own; the
// wave / gold copies are kept in step with the base clip.
export function wakeFires(root) {
  root.querySelectorAll('.fire3d').forEach((host) => {
    const vids = host.querySelectorAll('video[autoplay]');
    vids.forEach((v) => {
      v.muted = true;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    });
    const [base, ...extra] = vids;
    if (base && extra.length) {
      base.addEventListener('playing', () => extra.forEach((v) => { v.currentTime = base.currentTime; }), { once: true });
    }
  });
}

// The master's own fire: always in a dark stone plaque (the blend needs a dark
// backing) with a slider along the whole spectrum, 0 days .. 70 (the very
// strongest one). The choice is remembered on this device.
const MASTER_FIRE_KEY = 'hk_master_fire';
function masterFireValue() {
  try {
    const raw = localStorage.getItem(MASTER_FIRE_KEY);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) && v >= 0 && v <= 70 ? v : 70;
  } catch (e) {
    return 70;
  }
}
export function masterFireHTML() {
  const v = masterFireValue();
  return `
    <span class="streak-wrap"><div class="streak-btn streak-stage master-plaque">
      <span class="streak-btn-flame" id="masterFireHost">${fireHTML(v)}</span>
      <label class="streak-btn-text master-fire-ctl">עוצמת האש
        <input type="range" id="masterFireRange" min="0" max="70" step="1" value="${v}" aria-label="עוצמת האש">
        <span class="streak-btn-count" id="masterFireVal">${v}</span>
      </label>
    </div>${leverHTML()}</span>`;
}
export function wireMasterFire(root) {
  const range = root.querySelector('#masterFireRange');
  const host = root.querySelector('#masterFireHost');
  const val = root.querySelector('#masterFireVal');
  if (!range || !host) return;
  wakeFires(host);
  range.addEventListener('input', () => {
    const v = Number(range.value);
    if (val) val.textContent = String(v);
    host.innerHTML = fireHTML(v);
    wakeFires(host);
    try { localStorage.setItem(MASTER_FIRE_KEY, String(v)); } catch (e) { /* ignore */ }
  });
}

// Tap on the big flame: a quick pulse plus a small burst of sparks.
function pokeFlame(host, count = 8, pulse = true) {
  const flame = host.querySelector('.fire3d, .flame');
  if (!flame) return;
  if (pulse) {
    flame.classList.remove('is-poked');
    void flame.offsetWidth;
    flame.classList.add('is-poked');
  }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement('i');
    p.className = 'flame-burst';
    const angle = (-90 + (Math.random() - 0.5) * 150) * (Math.PI / 180);
    const dist = 26 + Math.random() * 26;
    p.style.setProperty('--bx', `${(Math.cos(angle) * dist).toFixed(1)}px`);
    p.style.setProperty('--by', `${(Math.sin(angle) * dist).toFixed(1)}px`);
    p.addEventListener('animationend', () => p.remove());
    host.appendChild(p);
  }
}

// --- the lever on the plaque ------------------------------------------------
// Pulling it (once per 24h) ignites the fire AND spins the daily sentence.
export function leverHTML() {
  return `
    <button type="button" class="lever" id="leverBtn" aria-label="משוך את הידית: משפט יומי והבערת האש">
      <span class="lever-boss" aria-hidden="true"></span>
      <span class="lever-arm" aria-hidden="true"><span class="lever-rod"></span><span class="lever-knob"></span></span>
      <span class="lever-timer" id="leverTimer" aria-hidden="true"></span>
    </button>`;
}

// The fire wakes from small to full with a flash and a burst of sparks.
// Resolves when the show is over (the sentence waits for it).
const IGNITE_MS = 2600;
export function igniteFlame(host) {
  const fire = host && host.querySelector('.fire3d');
  const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fire || still) return new Promise((r) => setTimeout(r, 600));
  fire.classList.remove('is-igniting');
  void fire.offsetWidth;
  fire.classList.add('is-igniting');
  const flash = document.createElement('i');
  flash.className = 'fire-flash';
  flash.addEventListener('animationend', () => flash.remove());
  fire.appendChild(flash);
  setTimeout(() => pokeFlame(host, 12, false), 1700);
  setTimeout(() => pokeFlame(host, 14, false), 2000);
  setTimeout(() => fire.classList.remove('is-igniting'), IGNITE_MS + 100);
  return new Promise((r) => setTimeout(r, IGNITE_MS));
}

// Master's student preview: "הדגמת צמיחה" -- every 10 seconds the fire steps
// to the next stage of the ladder (0, 1, 2, 3, 5 ... 70) and after the top
// it falls back to 0 and grows again, so every stage can be watched.
let fireDemoTimer = null;
export function wireFireDemo(root, btn) {
  const days = FIRE_LADDER.map((r) => r.d);
  const label = btn.textContent;
  btn.addEventListener('click', () => {
    if (fireDemoTimer) {
      clearInterval(fireDemoTimer);
      fireDemoTimer = null;
      btn.classList.remove('is-on');
      btn.textContent = label;
      return;
    }
    let k = 0;
    const step = () => {
      if (!document.body.contains(btn)) {
        clearInterval(fireDemoTimer);
        fireDemoTimer = null;
        return;
      }
      const d = days[k % days.length];
      const open = root.querySelector('#streakOpenBtn');
      const host = open && open.querySelector('.streak-btn-flame');
      if (host) {
        host.innerHTML = fireHTML(d);
        const cnt = open.querySelector('.streak-btn-count');
        if (cnt) cnt.textContent = String(d);
        wakeFires(open);
        if (k % days.length !== 0) pokeFlame(host, 14, true);
      }
      k += 1;
    };
    step();
    fireDemoTimer = setInterval(step, 10000);
    btn.classList.add('is-on');
    btn.textContent = 'עצור הדגמה';
  });
}

// --- student button + popup ------------------------------------------------

export function streakButtonHTML(state) {
  const n = state ? state.currentStreak : 0;
  return `
    <button type="button" class="streak-btn streak-stage${n > 0 ? ' is-lit' : ''}" id="streakOpenBtn" aria-haspopup="dialog"${state ? '' : ' hidden'}>
      <span class="streak-btn-flame">${state ? fireHTML(n) : ''}</span>
      <span class="streak-btn-text">הרצף שלך<span class="streak-btn-count">${n}</span><span class="streak-btn-cue">לחץ לפתיחת המפה ◂</span></span>
    </button>`;
}

// One row per milestone (plus a small "start" row on top). Every row has the
// same height and its node sits at the row's top, so a single rail drawn
// behind them (see .road-rail in dashboard.css) lines up with all the nodes.
function roadRowHTML(reward, streak, best, claimedIds, canClaim) {
  const reached = best >= reward.days;
  const claimed = claimedIds.has(reward.id);
  const state = claimed ? 'is-claimed' : reached ? 'is-ready' : 'is-locked';
  const nodeIcon = claimed ? ICONS.check : reached ? rewardIcon(reward) : ICONS.lock;
  let action = '';
  if (claimed) action = '<span class="road-note">נאספה. ג\'אוריוס יחזור אליך עם הפרטים</span>';
  else if (reached && canClaim) action = `<button type="button" class="btn-gold small road-claim-btn" data-reward-id="${escapeAttr(reward.id)}">קבל את המתנה</button>`;
  else if (reached) action = '<span class="road-note">זמינה לאיסוף</span>';
  else action = `<span class="road-note">עוד ${reward.days - streak} ${daysWord(reward.days - streak)}</span>`;

  return `
    <div class="road-row ${state}">
      <span class="road-node">${nodeIcon}</span>
      <div class="road-card">
        <span class="road-days">${reward.days} ${daysWord(reward.days)}</span>
        <span class="road-title">${escapeHtml(reward.title)}</span>
        ${reward.description ? `<span class="road-desc">${escapeHtml(reward.description)}</span>` : ''}
        ${action}
      </div>
    </div>`;
}

// Where the streak sits along the rail, measured in "rows": whole rows for
// the milestones already passed, plus the way to the next one. The part
// between two nodes is squeezed into the middle 40% of the gap so the
// "you are here" marker never lands on top of a node; `onNode` is true when
// the streak sits exactly on a milestone (the node itself is the marker).
function roadPosition(streak, rewards) {
  let passed = 0;
  let prevDays = 0;
  for (const r of rewards) {
    if (streak >= r.days) {
      passed += 1;
      prevDays = r.days;
    } else {
      const frac = (streak - prevDays) / (r.days - prevDays);
      return { pos: frac > 0 ? passed + 0.3 + 0.4 * frac : passed, onNode: frac === 0 && passed > 0 };
    }
  }
  return { pos: passed, onNode: true };
}

export function streakModalBodyHTML({ state, rewards, claimedIds, canClaim }) {
  const streak = state ? state.currentStreak : 0;
  const best = state ? state.bestStreak : 0;
  const next = rewards.find((r) => r.days > streak);
  const sub = next
    ? `עוד ${next.days - streak} ${daysWord(next.days - streak)} למתנה הבאה`
    : rewards.length
      ? 'הגעת לכל המתנות. כל הכבוד'
      : 'המתנות בדרך';
  const { pos, onNode } = roadPosition(streak, rewards);
  const showHere = streak > 0 && !onNode;
  const road = rewards.length
    ? `
    <div class="road" style="--road-n:${rewards.length};--road-pos:${pos.toFixed(3)}">
      <div class="road-rail" aria-hidden="true">
        <div class="road-rail-fill"></div>
        ${showHere ? `<span class="road-here" title="אתה כאן">${streak}</span>` : ''}
      </div>
      <div class="road-row is-start"><span class="road-node"></span><div class="road-card"><span class="road-title">ההתחלה</span></div></div>
      ${rewards.map((r) => roadRowHTML(r, streak, best, claimedIds, canClaim)).join('')}
    </div>`
    : '';
  return `
    <div class="streak-hero">
      <button type="button" class="streak-hero-flame" id="streakFlameBtn" aria-label="להבת הרצף">${fireHTML(streak)}</button>
      <span class="streak-hero-number">${streak}</span>
      <div class="streak-hero-text">
        <span class="streak-hero-label">${streak === 1 ? 'יום ברצף' : 'ימים ברצף'}</span>
        <span class="streak-hero-sub">${sub}</span>
      </div>
    </div>
    ${road}
    <p class="streak-rule">נכנסים פעם ביום וממשיכים. דילוג על יום שלם מחזיר את הרצף ל-0.</p>`;
}

export function streakModalHTML() {
  return `
    <div class="personal-modal-overlay" id="streakOverlay" hidden>
      <div class="personal-modal-card panel-card streak-modal-card">
        <div class="personal-modal-header">
          <h3 class="personal-block-title">הרצף שלך</h3>
          <button type="button" class="personal-modal-close" id="streakClose" aria-label="סגירה">✕</button>
        </div>
        <div class="personal-modal-body" id="streakModalBody"></div>
      </div>
    </div>`;
}

// Fills the popup + wires open/close/claim. `session` is the real student
// (counts today's login) or a demo (preview: never writes). `demoState`
// forces fixed numbers for the master's student-view preview.
export async function mountStreak(root, session, { demoState = null } = {}) {
  const openBtn = root.querySelector('#streakOpenBtn');
  const overlay = root.querySelector('#streakOverlay');
  const body = root.querySelector('#streakModalBody');
  if (!openBtn || !overlay || !body) return;

  const isDemo = !!demoState;
  const [state, rewards, claimedList] = await Promise.all([
    isDemo ? Promise.resolve(demoState) : streakStore.touch(),
    streakStore.rewards.getAll(),
    isDemo ? Promise.resolve([]) : streakStore.claims.getForUser(session.id),
  ]);

  // Tables not created yet (supabase-streak.sql not run) -- show nothing
  // rather than a broken, always-zero streak.
  if (!state) {
    openBtn.hidden = true;
    return;
  }
  const claimedIds = new Set(claimedList);
  openBtn.hidden = false;
  const btnCount = openBtn.querySelector('.streak-btn-count');
  if (btnCount) btnCount.textContent = String(state.currentStreak);
  openBtn.classList.toggle('is-lit', state.currentStreak > 0);
  const btnFlame = openBtn.querySelector('.streak-btn-flame');
  if (btnFlame) btnFlame.innerHTML = fireHTML(state.currentStreak);
  wakeFires(openBtn);
  if (!isDemo) {
    try {
      const key = 'hk_fire_stage_' + session.id;
      const idx = fireStageIndex(state.currentStreak);
      const prevRaw = localStorage.getItem(key);
      localStorage.setItem(key, String(idx));
      if (prevRaw !== null && idx > Number(prevRaw)) setTimeout(() => pokeFlame(openBtn.querySelector('.streak-btn-flame')), 700);
    } catch (e) { /* ignore */ }
  }

  function paint() {
    body.innerHTML = streakModalBodyHTML({ state, rewards, claimedIds, canClaim: !isDemo });
    const flameBtn = body.querySelector('#streakFlameBtn');
    if (flameBtn) flameBtn.addEventListener('click', () => pokeFlame(flameBtn));
    wakeFires(body);
    body.querySelectorAll('.road-claim-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const ok = await streakStore.claims.claim(session.id, btn.dataset.rewardId);
        if (ok) claimedIds.add(btn.dataset.rewardId);
        paint();
      });
    });
  }

  const close = () => {
    overlay.hidden = true;
  };
  openBtn.addEventListener('click', () => {
    paint();
    overlay.hidden = false;
  });
  root.querySelector('#streakClose')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

// --- master-only: "ניהול מתנות הרצף" ---------------------------------------

export function streakRewardsManagerHTML({ rewards, claims, nameById, rewardById, editing }) {
  const isEditing = !!editing;
  const cards = rewards
    .map(
      (r) => `
      <div class="hl-card" data-id="${escapeAttr(r.id)}">
        <p class="hl-card-text">${r.days} ${daysWord(r.days)} · ${escapeHtml(r.title)}</p>
        ${r.description ? `<p class="hl-card-meta">${escapeHtml(r.description)}</p>` : ''}
        <div class="hl-card-actions">
          <button type="button" class="btn-ghost small" data-streak-action="edit">עריכה</button>
          <button type="button" class="btn-ghost small danger" data-streak-action="delete">מחיקה</button>
        </div>
      </div>`
    )
    .join('');
  const claimRows = claims
    .slice(0, 12)
    .map((c) => {
      const reward = rewardById.get(c.rewardId);
      const when = new Date(c.claimedAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
      return `<p class="hl-card-meta">${escapeHtml(nameById.get(c.userId) || 'משתמש')} · ${escapeHtml(reward ? reward.title : 'מתנה שנמחקה')} · ${when}</p>`;
    })
    .join('');
  const iconOptions = REWARD_ICON_OPTIONS.map(
    (o) => `<option value="${o.value}" ${isEditing && editing.icon === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');
  return `
    <form id="streakRewardForm" novalidate>
      <div class="field-group">
        <label for="streakRewardDays">${isEditing ? 'עריכת מתנה' : 'מתנה חדשה'} · כמה ימים ברצף</label>
        <input type="number" min="1" id="streakRewardDays" placeholder="לדוגמה: 30" value="${isEditing ? editing.days : ''}">
      </div>
      <div class="field-group">
        <label for="streakRewardTitle">שם המתנה</label>
        <input type="text" id="streakRewardTitle" placeholder="לדוגמה: פגישת ערך אישית" value="${isEditing ? escapeAttr(editing.title) : ''}">
      </div>
      <div class="field-group">
        <label for="streakRewardDesc">תיאור קצר (לא חובה)</label>
        <input type="text" id="streakRewardDesc" value="${isEditing ? escapeAttr(editing.description) : ''}">
      </div>
      <div class="field-group">
        <label for="streakRewardIcon">אייקון</label>
        <select id="streakRewardIcon">${iconOptions}</select>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-gold small">${isEditing ? 'שמירת שינויים' : 'הוספה'}</button>
        ${isEditing ? '<button type="button" class="btn-ghost small" id="streakRewardCancel">ביטול</button>' : ''}
      </div>
    </form>
    <div class="hl-card-list">${cards || '<p class="placeholder-desc">אין עדיין מתנות.</p>'}</div>
    ${claimRows ? `<p class="admin-focus-existing-title">נאספו לאחרונה:</p>${claimRows}` : ''}`;
}

export function wireStreakRewardsManager(root, { rewards, rerender, getEditingId, setEditingId }) {
  const form = root.querySelector('#streakRewardForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = parseInt(root.querySelector('#streakRewardDays').value, 10);
    const title = root.querySelector('#streakRewardTitle').value.trim();
    const description = root.querySelector('#streakRewardDesc').value.trim();
    const icon = root.querySelector('#streakRewardIcon').value;
    if (!days || days < 1 || !title) return;
    const editingId = getEditingId();
    if (editingId) {
      const updated = await streakStore.rewards.update(editingId, { days, title, description, icon });
      if (updated) {
        const idx = rewards.findIndex((r) => r.id === editingId);
        if (idx !== -1) rewards[idx] = updated;
      }
      setEditingId(null);
    } else {
      const created = await streakStore.rewards.create({ days, title, description, icon });
      if (created) rewards.push(created);
    }
    rewards.sort((a, b) => a.days - b.days);
    await rerender();
  });

  root.querySelector('#streakRewardCancel')?.addEventListener('click', async () => {
    setEditingId(null);
    await rerender();
  });

  root.querySelectorAll('[data-streak-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-id]').dataset.id;
      if (btn.dataset.streakAction === 'edit') {
        setEditingId(id);
        await rerender();
        return;
      }
      if (!window.confirm('למחוק את המתנה? גם רישומי האיסוף שלה יימחקו.')) return;
      await streakStore.rewards.remove(id);
      const idx = rewards.findIndex((r) => r.id === id);
      if (idx !== -1) rewards.splice(idx, 1);
      if (getEditingId() === id) setEditingId(null);
      await rerender();
    });
  });
}
