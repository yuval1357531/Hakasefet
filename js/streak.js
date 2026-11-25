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
import { fetchIceGoals, meltLesson } from './lessonUnlock.js';
import { watchClip } from './focusMode.js';

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
  ice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2.5L15 4M9 20l3-2.5 3 2.5M3 10.5l3.6-.8-.7-3.6M21 13.5l-3.6.8.7 3.6M3 13.5l3.6.8-.7 3.6M21 10.5l-3.6-.8.7-3.6"/></svg>',
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
      watchClip(v);
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
    <div class="streak-btn streak-stage master-plaque">
      <span class="streak-btn-flame" id="masterFireHost">${fireHTML(v)}</span>
      <label class="streak-btn-text master-fire-ctl">עוצמת האש
        <input type="range" id="masterFireRange" min="0" max="70" step="1" value="${v}" aria-label="עוצמת האש">
        <span class="streak-btn-count" id="masterFireVal">${v}</span>
      </label>
    </div>`;
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
      <span class="streak-btn-text">הרצף שלך<span class="streak-btn-count">${n}</span><span class="streak-btn-cue"><svg class="streak-map-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6.5 8.5l3.5 3.5M10 8.5l-3.5 3.5"/><circle cx="16" cy="14.5" r="2.3"/><path d="M5.5 17.2c2.5-1.8 5 .8 7.2-.6" stroke-dasharray="1.6 1.8"/></svg>לחץ לפתיחת המפה ◂</span></span>
    </button>`;
}

// --- the road as a spine ------------------------------------------------------
// The road is a vertical spine, one vertebra per day, climbing bottom to top
// (the way the fire travels): a tailbone is the start, a crystal crowns the
// end. Every stop (a frozen-lesson goal and/or a gift on the same day) sits at
// its true day along the spine, alternating right and left so close stops never
// collide. Stops are only the words "N ימים" (+ a gift mark) and an underlined
// "tap to see" link; the link opens a small bubble with a gem per lesson.
// Everything is built from the real data (gifts + ice goals), so adding a
// lesson to a level or a new level shows up here by itself.
// Pixels per day: tighter on phones so most of the spine fits on one screen.
const spinePx = () => (window.innerWidth <= 600 ? 10 : 14);
const SPINE_TAIL = 62;
const SPINE_CROWN = 66;
const SPINE_EXTRA_DAYS = 10;
const SPINE_FX_W = 120;
// Which of the eight bone shapes each day gets (scrambled so no pattern shows).
const BONE_ORDER = [0, 3, 6, 1, 4, 7, 2, 5];

// Spark colours follow the fire: blue-white, warming toward gold where the fire does.
function sparkPalette(streak) {
  const row = FIRE_LADDER[fireStageIndex(streak)];
  const g = Math.min(1, (row.gold || 0) * 1.6);
  const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * g)).join(',');
  return { core: mix([226, 244, 255], [255, 236, 190]), glow: mix([90, 170, 255], [255, 188, 80]) };
}

// --- the sparks themselves ----------------------------------------------------
// A handful of tiny lights climb from the fire in a loose helix around the
// spine: x = sin(angle), depth = cos(angle). Depth decides the layer (front or
// behind the bones), the size and the brightness. The helix tightens toward the
// end so each light spirals INTO today's bone, which flashes as it lands.
// Runs only while the map is open (see runSpineFx / stopSpineFx).
let fxRaf = 0;
function stopSpineFx() {
  if (fxRaf) cancelAnimationFrame(fxRaf);
  fxRaf = 0;
}
function runSpineFx(root) {
  stopSpineFx();
  const back = root.querySelector('.spine-fx-back');
  const front = root.querySelector('.spine-fx-front');
  if (!back || !front) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const W = Number(front.dataset.w);
  const H = Number(front.dataset.h);
  const y0 = Number(front.dataset.y0);
  const y1 = Number(front.dataset.y1);
  const core = front.dataset.core;
  const glow = front.dataset.glow;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  [back, front].forEach((c) => { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
  const bc = back.getContext('2d');
  const fc = front.getContext('2d');
  if (!bc || !fc) return;
  [bc, fc].forEach((c) => { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalCompositeOperation = 'lighter'; });
  const cx = W / 2;
  const L = Math.max(24, y0 - y1);
  const turns = Math.max(1, Math.min(3.5, L / 110));
  const TAU = Math.PI * 2;
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const make = (phase) => ({
    t: phase,
    dur: 3.2 + Math.random() * 1.1,
    th0: Math.random() * TAU,
    R: 18 + Math.random() * 8,
    size: 1 + Math.random() * 0.5,
  });
  // Where a spark is at moment t: computed, not remembered, so the tail stays
  // one smooth ribbon at any frame rate.
  const at = (p, u) => {
    const e = 0.6 * u + 0.4 * (1 - (1 - u) * (1 - u));
    const env = Math.sin(Math.min(u / 0.16, 1) * Math.PI / 2) * (1 - smooth(0.82, 1, u));
    const th = p.th0 + turns * TAU * e;
    return { x: cx + p.R * env * Math.sin(th), y: y0 - L * e, z: Math.cos(th) };
  };
  const TAIL = 34;
  const N = 6;
  const ps = Array.from({ length: N }, (_, i) => make(i / N));
  // One soft light, drawn once and stamped everywhere (cheap on phones).
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const sc = sprite.getContext('2d');
  const sg = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
  sg.addColorStop(0, `rgba(${core},1)`);
  sg.addColorStop(0.3, `rgba(${glow},0.55)`);
  sg.addColorStop(1, `rgba(${glow},0)`);
  sc.fillStyle = sg;
  sc.fillRect(0, 0, 64, 64);
  const dot = (ctx, x, y, rad, a) => {
    if (a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(sprite, x - rad * 3, y - rad * 3, rad * 6, rad * 6);
  };
  let flash = 0;
  let last = performance.now();
  function frame(now) {
    if (!root.isConnected) { fxRaf = 0; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    bc.clearRect(0, 0, W, H);
    fc.clearRect(0, 0, W, H);
    ps.forEach((p, i) => {
      p.t += dt / p.dur;
      if (p.t >= 1) { flash = 1; ps[i] = make(0); return; }
      const fade = Math.min(1, p.t / 0.1);
      for (let k = TAIL; k >= 0; k -= 1) {
        const u = p.t - (k * 0.016) / p.dur;
        if (u <= 0) continue;
        const q = at(p, u);
        const near = 1 - k / (TAIL + 1);
        const depth = 0.5 + 0.5 * q.z;
        // behind the spine: dimmer, and almost hidden where a bone covers it
        const covered = q.z < 0 && Math.abs(q.x - cx) < 11 ? 0.25 : 1;
        const a = (k === 0 ? 1 : 0.34 * near * near) * (0.35 + 0.65 * depth) * covered * fade;
        dot(q.z >= 0 ? fc : bc, q.x, q.y, p.size * (0.7 + 0.8 * depth) * (k === 0 ? 1.7 : 0.35 + 0.65 * near), a);
      }
    });
    flash = Math.max(0, flash - dt * 1.7);
    dot(fc, cx, y1, 7 + 6 * flash, 0.35 + 0.55 * flash);
    fxRaf = requestAnimationFrame(frame);
  }
  fxRaf = requestAnimationFrame(frame);
}

function spineStopHTML(stop, i, ctx) {
  const { streak, best, claimedIds, canClaim, topDay, px } = ctx;
  const reached = best >= stop.days;
  const side = i % 2 === 0 ? 'is-right' : 'is-left';
  const hasIce = !!stop.goal;
  const hasGift = stop.rewards.length > 0;
  const kind = hasIce ? 'is-ice' : 'is-gift';
  const giftMark = hasGift ? `<span class="spine-gift">${stop.rewards.length === 1 ? rewardIcon(stop.rewards[0]) : ICONS.gift}</span>` : '';
  const linkText = hasIce ? 'לחץ כדי לראות מה נמס ביעד הזה' : 'לחץ כדי לראות מה המתנה ביעד הזה';
  const y = SPINE_TAIL + (stop.days - 0.5) * px;
  const gems = hasIce
    ? stop.goal.lessons.map((l) => `<div class="spine-gem"><i aria-hidden="true"></i><span>${escapeHtml(l.title)}</span></div>`).join('')
    : '';
  const gifts = stop.rewards
    .map((r) => {
      const claimed = claimedIds.has(r.id);
      let act;
      if (claimed) act = '<span class="road-note">נאספה. ג\'אוריוס יחזור אליך עם הפרטים</span>';
      else if (reached && canClaim) act = `<button type="button" class="btn-gold small road-claim-btn" data-reward-id="${escapeAttr(r.id)}">קבל את המתנה</button>`;
      else if (reached) act = '<span class="road-note">זמינה לאיסוף</span>';
      else act = '';
      return `<div class="spine-prize"><span class="spine-gift">${rewardIcon(r)}</span><div><b>${escapeHtml(r.title)}</b>${r.description ? `<span>${escapeHtml(r.description)}</span>` : ''}${act}</div></div>`;
    })
    .join('');
  let iceAct = '';
  if (hasIce) {
    if (reached && canClaim) iceAct = `<button type="button" class="btn-gold small road-melt-btn" data-ice-days="${stop.days}">המס את הקרח</button>`;
    else if (reached) iceAct = '<span class="road-note">מוכן להמסה</span>';
  }
  const left = stop.days - streak;
  const remain = !reached && left > 0 ? `<span class="road-note">עוד ${left} ${daysWord(left)}</span>` : '';
  // Stops near the crown open their bubble downward so it never leaves the spine.
  const popPos = stop.days > topDay - 22 ? `top:${SPINE_CROWN + (topDay - stop.days) * px + 10}px` : `bottom:${y + 14}px`;
  return `
      <div class="spine-stop ${side} ${kind}${reached ? ' is-reached' : ''}" style="bottom:${y}px">
        <span class="spine-stop-days">${stop.days} ${daysWord(stop.days)}${giftMark}</span>
        <button type="button" class="spine-open" data-spine-open="${stop.days}">${linkText}</button>
      </div>
      <div class="spine-pop" data-pop="${stop.days}" style="${popPos}" hidden>
        ${gems}${gifts}${iceAct}${remain}
      </div>`;
}

function spineHTML({ stops, streak, best, claimedIds, canClaim }) {
  const lastDay = stops.length ? stops[stops.length - 1].days : 0;
  // The road proper, and past its end one more gold bone for every further day.
  const roadEnd = Math.max(60, lastDay) + SPINE_EXTRA_DAYS;
  const topDay = Math.max(roadEnd, streak);
  // day -> which side its text sits on (0 = right, 1 = left), same rule as spineStopHTML
  const stopDays = new Map(stops.map((s, i) => [s.days, i % 2]));
  const bones = [];
  for (let d = 1; d <= topDay; d += 1) {
    const w = 14 + Math.round(10 * Math.sin((Math.PI * d) / (topDay + 1)));
    const cls = ['vert', `v${BONE_ORDER[d % 8]}`];
    if (d <= streak) cls.push('is-done');
    if (d === streak) cls.push('is-today');
    if (d > roadEnd - SPINE_EXTRA_DAYS) cls.push('is-final');
    if (stopDays.has(d)) cls.push('is-stop', stopDays.get(d) % 2 === 0 ? 'to-right' : 'to-left');
    bones.push(`<i class="${cls.join(' ')}" style="--w:${w}px"></i>`);
  }
  const px = spinePx();
  const ctx = { streak, best, claimedIds, canClaim, topDay, px };
  const shown = Math.min(Math.max(streak, 0), topDay);
  const hereY = SPINE_TAIL + (shown - 0.5) * px;
  // Today's number sits in gold beside its bone, on the side with no goal text close by.
  const near = stops.map((s, i) => ({ d: s.days, right: i % 2 === 0 })).filter((o) => Math.abs(o.d - shown) <= 3);
  const hereSide = near.some((o) => o.right) && !near.some((o) => !o.right) ? 'is-left' : 'is-right';
  const here = streak > 0 ? `<span class="spine-here ${hereSide}" style="bottom:${hereY}px" title="אתה כאן">${streak}</span>` : '';
  // Light sparks that leave the fire, spiral round the spine (behind it and in
  // front of it) and flow into today's bone. Two canvases give the depth.
  const fxH = SPINE_TAIL + shown * px + 26;
  const pal = sparkPalette(streak);
  const fxSize = `style="width:${SPINE_FX_W}px;height:${fxH}px" aria-hidden="true"`;
  const fxBack = streak > 0 ? `<canvas class="spine-fx spine-fx-back" ${fxSize}></canvas>` : '';
  const fxFront = streak > 0
    ? `<canvas class="spine-fx spine-fx-front" ${fxSize} data-w="${SPINE_FX_W}" data-h="${fxH}" data-y0="${fxH - 24}" data-y1="${fxH - hereY}" data-core="${pal.core}" data-glow="${pal.glow}"></canvas>`
    : '';
  return `
    <div class="spine" style="--spine-px:${px}px;height:${SPINE_TAIL + topDay * px + SPINE_CROWN}px">
      <svg class="spine-crown" viewBox="0 0 40 52" aria-hidden="true"><path d="M20 2l12 14-12 34L8 16z" /><path d="M8 16h24M20 2l-5 14 5 34M20 2l5 14-5 34" fill="none"/></svg>
      ${fxBack}
      <div class="spine-col">${bones.join('')}</div>
      ${fxFront}
      <span class="spine-fire"><button type="button" class="streak-hero-flame" id="streakFlameBtn" aria-label="להבת הרצף">${fireHTML(streak)}</button></span>
      ${stops.map((st, i) => spineStopHTML(st, i, ctx)).join('')}
      ${here}
    </div>`;
}

export function streakModalBodyHTML({ state, rewards: giftRewards, claimedIds, canClaim, iceGoals = [] }) {
  const streak = state ? state.currentStreak : 0;
  const best = state ? state.bestStreak : 0;
  const rewards = giftRewards;
  // A gift already reached at the best streak stays theirs, so it isn't "next".
  const next = rewards.find((r) => r.days > Math.max(streak, best));
  // Gifts and frozen-lesson goals share one spine; the same day holds both.
  const byDay = new Map();
  const slot = (days) => {
    if (!byDay.has(days)) byDay.set(days, { days, goal: null, rewards: [] });
    return byDay.get(days);
  };
  rewards.forEach((r) => slot(r.days).rewards.push(r));
  iceGoals.forEach((g) => { slot(g.days).goal = g; });
  const mergedStops = [...byDay.values()].sort((a, b) => a.days - b.days);
  const stops = mergedStops;
  const sub = next
    ? `עוד ${next.days - streak} ${daysWord(next.days - streak)} למתנה הבאה`
    : rewards.length
      ? 'הגעת לכל המתנות. כל הכבוד'
      : 'המתנות בדרך';
  const road = stops.length ? spineHTML({ stops: mergedStops, streak, best, claimedIds, canClaim }) : '';
  return `
    ${road}
    ${road
      ? `<div class="streak-hero is-base">
      <div class="streak-hero-row">
        <span class="streak-hero-number">${streak}</span>
        <span class="streak-hero-label">${streak === 1 ? 'יום ברצף' : 'ימים ברצף'}</span>
      </div>
      <span class="streak-hero-sub">${sub}</span>
    </div>`
      : `<div class="streak-hero">
      <button type="button" class="streak-hero-flame" id="streakFlameBtn" aria-label="להבת הרצף">${fireHTML(streak)}</button>
      <span class="streak-hero-number">${streak}</span>
      <div class="streak-hero-text">
        <span class="streak-hero-label">${streak === 1 ? 'יום ברצף' : 'ימים ברצף'}</span>
        <span class="streak-hero-sub">${sub}</span>
      </div>
    </div>`}
    <p class="streak-rule">מדליקים את הידית פעם ביום וממשיכים. רצף שנשבר חוזר לאפס, אבל המתנות והיעדים שהגעת אליהם נשמרים.</p>`;
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
  const [stateNow, rewards, claimedList, iceGoalsAll] = await Promise.all([
    isDemo ? Promise.resolve(demoState) : streakStore.getState(),
    streakStore.rewards.getAll(),
    isDemo ? Promise.resolve([]) : streakStore.claims.getForUser(session.id),
    fetchIceGoals(isDemo),
  ]);
  let state = stateNow;
  let iceGoals = iceGoalsAll;

  // Tables not created yet (supabase-streak.sql not run) -- show nothing
  // rather than a broken, always-zero streak.
  if (!state) {
    openBtn.hidden = true;
    return;
  }
  const claimedIds = new Set(claimedList);
  openBtn.hidden = false;
  function paintButton() {
    const btnCount = openBtn.querySelector('.streak-btn-count');
    if (btnCount) btnCount.textContent = String(state.currentStreak);
    openBtn.classList.toggle('is-lit', state.currentStreak > 0);
    const btnFlame = openBtn.querySelector('.streak-btn-flame');
    if (btnFlame) btnFlame.innerHTML = fireHTML(state.currentStreak);
    wakeFires(openBtn);
  }
  paintButton();
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
    body.innerHTML = streakModalBodyHTML({ state, rewards, claimedIds, canClaim: !isDemo, iceGoals });
    const flameBtn = body.querySelector('#streakFlameBtn');
    if (flameBtn) flameBtn.addEventListener('click', () => pokeFlame(flameBtn));
    wakeFires(body);
    if (!overlay.hidden) runSpineFx(body);
    const spine = body.querySelector('.spine');
    if (spine) {
      const closePops = () => spine.querySelectorAll('.spine-pop').forEach((p) => { p.hidden = true; });
      spine.querySelectorAll('[data-spine-open]').forEach((link) => {
        link.addEventListener('click', () => {
          const pop = spine.querySelector(`.spine-pop[data-pop="${link.dataset.spineOpen}"]`);
          const wasOpen = pop && !pop.hidden;
          closePops();
          if (pop && !wasOpen) pop.hidden = false;
        });
      });
      spine.addEventListener('click', (e) => {
        if (!e.target.closest('.spine-pop, [data-spine-open]')) closePops();
      });
    }
    body.querySelectorAll('.road-melt-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const days = Number(btn.dataset.iceDays);
        const goal = iceGoals.find((g) => g.days === days);
        if (!goal) return;
        const row = btn.closest('.spine-pop');
        row?.classList.add('is-melting');
        const results = await Promise.all(goal.lessons.map((l) => meltLesson(l.section, l.id)));
        if (results.every(Boolean)) iceGoals = iceGoals.filter((g) => g.days !== days);
        setTimeout(() => { if (!overlay.hidden) paint(); }, 1100);
      });
    });
    body.querySelectorAll('.road-claim-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const ok = await streakStore.claims.claim(session.id, btn.dataset.rewardId);
        if (ok) claimedIds.add(btn.dataset.rewardId);
        if (!overlay.hidden) paint();
      });
    });
  }

  // While the map is open nothing else on the page animates (focusMode.js).
  const close = () => {
    overlay.hidden = true;
    stopSpineFx();
    window.removeEventListener('hashchange', close);
    body.innerHTML = '';
  };
  // The spine is tall and starts at the bottom: bring the streak's own
  // position into view when the popup opens.
  function showHere() {
    const here = body.querySelector('.spine-here');
    if (!here) return;
    let scroller = body;
    while (scroller && scroller !== document.body) {
      const oy = getComputedStyle(scroller).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) return;
    const sr = scroller.getBoundingClientRect();
    const hr = here.getBoundingClientRect();
    scroller.scrollTop += hr.top - sr.top - sr.height / 2 + hr.height / 2;
  }
  openBtn.addEventListener('click', () => {
    paint();
    overlay.hidden = false;
    window.addEventListener('hashchange', close);
    showHere();
    runSpineFx(body);
  });
  root.querySelector('#streakClose')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // The number by the fire and the map always tell the same day.
  if (isDemo) {
    // master's student view: the lever moved the day (it repaints the fire itself)
    openBtn.addEventListener('streak:preview', (e) => {
      state = { ...state, currentStreak: e.detail.day, bestStreak: e.detail.day };
    });
    return;
  }
  // The lever was pulled and the server counted it: the number, the fire and
  // the map all step up together. Also re-read when the student comes back to
  // an app left open (a streak may have run out, or been lit on another
  // device). Reading never changes anything; a failed call keeps what is shown.
  let refreshing = false;
  async function refresh(pulled) {
    if (refreshing) return;
    refreshing = true;
    const fresh = await streakStore.getState().catch(() => null);
    refreshing = false;
    if (!fresh || !openBtn.isConnected) return;
    const changed = fresh.currentStreak !== state.currentStreak || fresh.bestStreak !== state.bestStreak;
    const grew = fresh.currentStreak > state.currentStreak;
    state = fresh;
    window.dispatchEvent(new CustomEvent('streak:changed', { detail: fresh }));
    if (!changed) return;
    paintButton();
    if (pulled && grew) {
      pokeFlame(openBtn.querySelector('.streak-btn-flame'), 14, true);
      const cnt = openBtn.querySelector('.streak-btn-count');
      if (cnt) {
        cnt.classList.remove('is-bumped');
        void cnt.offsetWidth;
        cnt.classList.add('is-bumped');
      }
    }
    if (!overlay.hidden) {
      paint();
      showHere();
    }
  }
  root.querySelector('#dailyWheel')?.addEventListener('wheel:saved', () => refresh(true));
  const onReturn = () => {
    if (!openBtn.isConnected) document.removeEventListener('visibilitychange', onReturn);
    else if (!document.hidden) refresh(false);
  };
  document.addEventListener('visibilitychange', onReturn);
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
