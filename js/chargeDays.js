// "מסלול בערה" -- the opening path into the Vault: seven steps (an intro,
// three lessons, three practices) that teach three qualities -- release,
// breath, will -- the ones that turn the animal fire into energy. Each step is
// a centre, root to crown, lit in its own colour once its video is marked
// watched. At most one step a day, and a missed day simply waits: the path has
// nothing to do with the lever streak. Everyone gets the invitation (a red
// stone above the fire); the end is a crown with a scroll beside the fire.
//
// The server keeps the path (supabase-burn-path.sql, burn_sync): it decides
// what counts, so it works the same on every device. The step list there and
// here must match.

import { burnStore } from './data/burnStore.js';

// The journey: release (in the head, then in the body), restore stability
// (breath), then build high (will).
const PHASES = [
  { name: 'שחרור', verb: 'להוריד', short: 'מתחים ואמונות מגבילות', what: 'מורידים מתחים מהגוף ואמונות מגבילות מהתודעה.', days: [0, 1, 2] },
  { name: 'נשימה', verb: 'לחזק', short: 'גוף ותודעה', what: 'מחזקים את הגוף באנרגיה חיובית וחדשה, ואת התודעה בכוונה ובדמיון.', days: [3, 4] },
  { name: 'רצון', verb: 'לעקוב', short: 'אחרי מה שמרגש, לבטא וליצור', what: 'עוקבים אחרי מה שמרגש ומרחיב אותך, ומשם מבטאים ויוצרים.', days: [5, 6] },
];

export const CHARGE_STEPS = [
  { section: 'vault', id: 'vlesson-1', task: 'מבוא ללמידה', color: '#ff4058' },
  { section: 'vault', id: 'vlesson-2', task: 'שיעור 1 · אנרגיה זכרית ונקבית', color: '#ff8a3d' },
  { section: 'survivalToFreedom', id: 'flesson-mu5030plj1cou', task: 'תרגול שחרור · 12 דק׳', color: '#ffd24a' },
  { section: 'vault', id: 'vlesson-mv0rn5xz9cmrr', task: 'שיעור 2 · נשימות', color: '#3fe08a' },
  { section: 'survivalToFreedom', id: 'flesson-mv0runti37o6a', task: 'תרגול נשימות', color: '#3fc6ff' },
  { section: 'vault', id: 'vlesson-3', task: 'שיעור 3 · הרצון שלך', color: '#7a6cff' },
  { section: 'survivalToFreedom', id: 'flesson-muny6f0zh91at', task: 'תרגול יציבות ושחרור · 13 דק׳', color: '#e6c4ff' },
];

const still = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

// From the server's log: which steps are done, and which one is open today
// ('today') or tomorrow ('next', when a step was already counted today).
// `fresh` = steps counted since this device last showed them: they ignite.
function plan(uid, state) {
  const log = state.log || {};
  const seenKey = 'hk_burn_seen_' + uid;
  const seen = new Set((lsGet(seenKey) || '').split(',').filter(Boolean));
  const fresh = new Set();
  CHARGE_STEPS.forEach((s, i) => { if (log[s.id] && !seen.has(s.id)) fresh.add(i); });
  if (fresh.size) lsSet(seenKey, CHARGE_STEPS.filter((s) => log[s.id]).map((s) => s.id).join(','));
  let open = true;
  const days = CHARGE_STEPS.map((s, i) => {
    if (log[s.id]) return 'done';
    if (!open) return 'locked';
    open = false;
    return i && log[CHARGE_STEPS[i - 1].id] === state.today ? 'next' : 'today';
  });
  return { days, fresh };
}

const CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18L19 8l-4.5 4L12 5l-2.5 7L5 8z"/></svg>';
const FIRE = 'linear-gradient(270deg, #ff4058, #ff8a3d, #ffd24a, #3fe08a, #3fc6ff, #7a6cff, #e6c4ff)';

export function chargeCardHTML() {
  return '<section id="burnCard" aria-label="מסלול בערה"></section>';
}

// Three stations on one thin line; a point of light travels along it, day by
// day (day 1 at the start, day 7 at the end).
function trackHTML(doneCount, lightColor, igniting) {
  // the ember sits on today's step; the line behind it is the way already lit
  const pos = doneCount >= 7 ? 1 : (doneCount + 0.5) / 7;
  // Each quality sits right under its own steps on the line: release over
  // steps 1-3, breath over 4-5, will over 6-7 (widths 3:2:2, no gaps, so the
  // columns line up exactly with the step dots).
  const kind = (st) => (st.task.startsWith('מבוא') ? 'מבוא' : st.task.startsWith('שיעור') ? 'שיעור' : 'תרגול');
  const groups = PHASES.map((p) => {
    const last = p.days[p.days.length - 1];
    const state = doneCount > last ? 'is-done' : doneCount >= p.days[0] ? 'is-now' : '';
    const steps = p.days.map((k) => `<span class="${k < doneCount ? 'is-lit' : ''}${k === doneCount ? ' is-next' : ''}" style="--c:${CHARGE_STEPS[k].color}">${kind(CHARGE_STEPS[k])}</span>`).join('');
    return `<div class="burn-group ${state}" style="--n:${p.days.length};--c:${CHARGE_STEPS[p.days[0]].color}"><div class="burn-group-steps">${steps}</div><b>${p.name}</b><small><em>${p.verb}</em> ${p.short}</small></div>`;
  }).join('');
  return `
    <div class="burn-track" style="--pos:${pos};--fire:${FIRE};--lc:${lightColor}">
      <span class="burn-rail"></span><span class="burn-fill"></span>
      ${CHARGE_STEPS.map((st, k) => `<i class="burn-dot${k < doneCount ? ' is-lit' : ''}" style="--k:${k};--c:${st.color}"></i>`).join('')}
      <i class="burn-gate" style="--k:3"></i><i class="burn-gate" style="--k:5"></i>
      <span class="burn-light${igniting ? ' is-igniting' : ''}"><i class="burn-hit"></i><i class="burn-halo"></i><i class="burn-core"></i><i class="burn-spark"></i><i class="burn-spark"></i><i class="burn-spark"></i></span>
    </div>
    <div class="burn-groups">${groups}</div>`;
}

let current = null; // { uid, step } -- for the note inside the lesson
// The master's student view: the same card, kept on this page only (nothing
// is saved) -- the invitation, then day 1 once "start" is pressed.
const previewState = { started: false, log: {}, today: '' };
const RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>';
function previewReset(root, session) {
  previewState.log = {};
  lsSet('hk_burn_seen_' + session.id, '');
  mountChargeDays(root, session, { preview: true });
}
function previewStep(root, session) {
  const next = CHARGE_STEPS.find((st) => !previewState.log[st.id]);
  if (!next) return;
  previewState.log[next.id] = '2000-01-01'; // an earlier day: the following step is open at once
  mountChargeDays(root, session, { preview: true, keep: true });
}
export async function mountChargeDays(root, session, { start = false, preview = false, keep = false } = {}) {
  const el = root.querySelector('#burnCard');
  if (!el || (session.role === 'admin' && !preview)) return;
  if (preview && !keep) { // the master's view always opens on the invitation
    previewState.started = start;
    if (!start) { previewState.log = {}; lsSet('hk_burn_seen_' + session.id, ''); }
  }
  const state = preview ? previewState : await burnStore.sync(start);
  if (!state || !el.isConnected) return;
  const { days, fresh } = plan(session.id, state);
  const doneCount = days.filter((d) => d === 'done').length;
  document.body.dataset.burn = String(doneCount);
  const i = days.findIndex((d) => d === 'today' || d === 'next');
  current = state.started && doneCount < 7 ? { step: CHARGE_STEPS[i], day: i + 1 } : null;
  watchLessons();

  const head = `
    <div class="burn-head">
      <div><b>מסלול בערה<button type="button" class="burn-info" aria-label="מה זה מסלול בערה">i</button></b><span>3 איכויות שהופכות את האש החייתית לאנרגיה אלוקית</span></div>
      <div class="burn-head-side">${doneCount < 7 ? `<span class="burn-count">${Math.min(doneCount + 1, 7)}<i>/7</i></span>` : ''}${preview ? `<button type="button" class="burn-reset" aria-label="חזרה להתחלה" title="חזרה להתחלה">${RESET}</button>` : ''}</div>
    </div>`;

  if (!state.started) {
    el.className = 'burn is-invite is-stone';
    el.innerHTML = '<button type="button" class="burn-start"><b>מסלול בערה</b><small>לחץ להתחלת המסלול <em aria-hidden="true">‹</em></small></button>';
    // Same width as the fire's plaque below it, edge to edge.
    const plaque = root.querySelector('#streakOpenBtn');
    if (plaque && window.ResizeObserver) {
      const fit = () => { if (plaque.offsetWidth) el.style.setProperty('--plaque-w', plaque.offsetWidth + 'px'); };
      fit();
      new ResizeObserver(fit).observe(plaque);
    }
    // The stone only opens the explanation; the path starts on "הבנתי, מתחילים".
    // The window's ✕ (or a tap outside it) backs out without starting.
    el.querySelector('.burn-start').addEventListener('click', () => {
      openInfo(true, async () => {
        el.classList.add('is-opening');
        await mountChargeDays(root, session, { start: true, preview });
      });
    });
    return;
  }

  if (doneCount === 7) {
    // The relic: just the crown. A scroll unrolls out of it to the right --
    // half out every time the home screen opens, all the way on a tap. Open,
    // the crown is the top centre (will) and the other six centres hang below
    // it, each quality written beside its own centres.
    el.className = 'burn is-badge';
    const rowOf = (k) => 7 - k; // centre k (0 = root) -> grid row (1 = crown)
    const dots = CHARGE_STEPS.slice(0, 6).map((st, k) => `<i style="--c:${st.color};grid-row:${rowOf(k) - 1}"></i>`).join('');
    const quals = PHASES.map((p) => `<li style="--c:${CHARGE_STEPS[p.days[0]].color};grid-row:${rowOf(p.days[p.days.length - 1])} / ${rowOf(p.days[0]) + 1}"><b>${p.name}</b><span>${p.what}</span></li>`).join('');
    el.innerHTML = `
      <div class="burn-relic" dir="ltr">
        <div class="burn-relic-col">
          <button type="button" class="burn-seal" aria-label="מסלול בערה" aria-expanded="false">${CROWN}</button>
          <div class="burn-relic-dots">${dots}</div>
        </div>
        <div class="burn-roll">
          <span class="burn-roll-rod"><b>מסלול בערה</b></span>
          <div class="burn-roll-sheet"><ul dir="rtl">${quals}</ul></div>
          <span class="burn-roll-rod is-end"></span>
        </div>
      </div>`;
    const relic = el.querySelector('.burn-relic');
    // the writing is laid out at the scroll's full open width
    const fitRoll = () => relic.style.setProperty('--roll-w', Math.max(200, relic.clientWidth - 46) + 'px');
    fitRoll();
    if (window.ResizeObserver) new ResizeObserver(fitRoll).observe(relic);
    const seal = el.querySelector('.burn-seal');
    const toggle = () => {
      const open = !relic.classList.contains('is-open');
      relic.classList.toggle('is-open', open);
      seal.setAttribute('aria-expanded', String(open));
    };
    requestAnimationFrame(() => requestAnimationFrame(() => relic.classList.add('is-half'))); // half out on arrival
    seal.addEventListener('click', toggle);
    el.querySelector('.burn-roll').addEventListener('click', toggle);
    if (preview) {
      const r = document.createElement('button');
      r.type = 'button';
      r.className = 'burn-reset is-relic';
      r.setAttribute('aria-label', 'חזרה להתחלה');
      r.innerHTML = RESET;
      r.addEventListener('click', () => previewReset(root, session));
      el.appendChild(r);
    }
    markCrown(root);
    if (fresh.has(6)) crownMoment();
    return;
  }

  const s = CHARGE_STEPS[i];
  // Today's one thing, as one row: what it is, and the way in.
  const task = days[i] === 'today'
    ? `<button type="button" class="burn-go" style="--c:${s.color}"><span><small>היום</small>${s.task}</span><i aria-hidden="true">▸</i></button>`
    : `<div class="burn-go is-wait"><span><small>בוערת להיום</small>מחר: ${s.task}</span></div>`;
  el.className = 'burn' + (el.classList.contains('is-opening') ? ' is-opening' : '');
  el.innerHTML = `${head}${trackHTML(doneCount, doneCount ? CHARGE_STEPS[Math.min(doneCount, 6)].color : CHARGE_STEPS[0].color, fresh.size > 0)}${task}`;
  el.querySelector('.burn-go')?.addEventListener('click', () => go(s, session.id));
  if (preview) {
    el.classList.add('is-preview');
    el.querySelector('.burn-reset')?.addEventListener('click', () => previewReset(root, session));
    el.querySelector('.burn-light')?.addEventListener('click', () => previewStep(root, session));
  }
  el.querySelector('.burn-info')?.addEventListener('click', () => openInfo(false));
}

// Inside the lesson of the open step: one quiet line, so the step gets counted.
let watching = false;
function watchLessons() {
  if (watching) return;
  watching = true;
  const check = async () => {
    if (!current) return;
    const target = `#/${current.step.section}/lesson/${current.step.id}`;
    if (window.location.hash !== target) return;
    const panel = await waitFor('.lesson-panel', 8000);
    if (!panel || panel.parentElement.querySelector('.burn-note') || window.location.hash !== target) return;
    const n = document.createElement('p');
    n.className = 'burn-note';
    n.style.setProperty('--c', current.step.color);
    n.innerHTML = `<b>מסלול בערה · יום ${current.day}</b> בסוף, לחץ "צפיתי בשיעור" והיום שלך נדלק.`;
    panel.parentElement.insertBefore(n, panel);
  };
  window.addEventListener('hashchange', check);
  check();
}

// What the path is, in one small window: right after "start", and behind
// the (i) next to the title.
function openInfo(starting = false, onStart = null) {
  if (document.querySelector('.burn-intro')) return;
  const w = document.createElement('div');
  w.className = 'burn-intro';
  w.innerHTML = `
    <div class="burn-intro-card" role="dialog" aria-label="מסלול בערה">
      <button type="button" class="burn-intro-x" aria-label="סגירה">✕</button>
      <b class="burn-intro-title">מסלול בערה</b>
      <p class="burn-intro-lead">מסלול שלוקח את האנרגיה התאוותית, האש החייתית, והופך אותה לנוכחות, ביטחון, וחדות בגוף ובראש. וזו רק ההתחלה.</p>
      <p class="burn-intro-sub">3 איכויות שאתה לומד בתהליך פשוט אך עמוק של 7 ימים</p>
      <div class="burn-intro-track"><span class="burn-intro-line"></span></div>
      <div class="burn-stations is-preview">${PHASES.map((p) => `<span class="burn-station is-now" style="--c:${CHARGE_STEPS[p.days[0]].color}"><b>${p.name}</b><small><em>${p.verb}</em> ${p.short}</small></span>`).join('')}</div>
      <div class="burn-intro-def"><b>מה זו איכות?</b>איכות היא לא משהו שאתה עושה או חושב. היא יכולת שחיה בך, בגוף, ברגש ובתודעה ביחד. ובכל רגע, אתה יכול לחזור אליהן ולעקרונות שתלמד כאן.</div>
      <button type="button" class="burn-intro-go">${starting ? 'הבנתי, מתחילים' : 'הבנתי'}</button>
    </div>`;
  const close = () => { w.classList.add('is-out'); setTimeout(() => w.remove(), 250); };
  w.addEventListener('click', (e) => { if (e.target === w) close(); });
  w.querySelector('.burn-intro-x').addEventListener('click', close);
  w.querySelector('.burn-intro-go').addEventListener('click', () => {
    close();
    if (onStart) onStart();
  });
  document.body.appendChild(w);
}

// The small crown of light that stays by the fire once the path is done.
function markCrown(root) {
  const btn = root.querySelector('#streakOpenBtn');
  if (!btn || btn.querySelector('.burn-mark')) return;
  const m = document.createElement('span');
  m.className = 'burn-mark';
  m.title = 'מסלול בערה הושלם';
  m.innerHTML = CROWN;
  btn.appendChild(m);
}

// Day 7: the seven lights rise and merge into one.
function crownMoment() {
  if (still()) return;
  const layer = document.createElement('div');
  layer.className = 'burn-moment';
  layer.innerHTML = `
    <div class="burn-moment-lights">${CHARGE_STEPS.map((s, k) => `<i style="--c:${s.color};--k:${k}"></i>`).join('')}<b></b></div>
    <p>שחרור · נשימה · רצון</p>`;
  document.body.appendChild(layer);
  layer.addEventListener('click', () => layer.remove());
  setTimeout(() => layer.classList.add('is-out'), 4200);
  setTimeout(() => layer.remove(), 5000);
}

// "התחל": the first time a day leads into a section, show the way there --
// the menu opens, the section lights up, the list scrolls to the lesson and it
// glows -- then it opens. Later days in the same section go straight in.
async function waitFor(sel, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const el = document.querySelector(sel);
    if (el) return el;
    await wait(120);
  }
  return null;
}
async function go(step, uid) {
  const target = `#/${step.section}/lesson/${step.id}`;
  const seenKey = `hk_charge_tour_${uid}_${step.section}`;
  let seen = false;
  try { seen = localStorage.getItem(seenKey) === '1'; localStorage.setItem(seenKey, '1'); } catch (e) { /* ignore */ }
  if (seen || still()) { window.location.hash = target; return; }

  document.body.classList.add('charge-touring');
  try {
    const nav = document.querySelector(`.nav-item[data-id="${step.section}"]`);
    const peek = document.getElementById('sidebarPeek');
    if (peek && !peek.hidden && !document.body.classList.contains('sidebar-open')) { peek.click(); await wait(450); }
    if (nav) {
      nav.scrollIntoView({ block: 'nearest' });
      nav.classList.add('charge-glow');
      await wait(1000);
      nav.classList.remove('charge-glow');
    }
    window.location.hash = `#/${step.section}`;
    const tab = await waitFor(`a.lesson-tab[href="${target}"]`);
    if (tab) {
      await wait(250);
      tab.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await wait(700);
      tab.style.setProperty('--c', step.color);
      tab.classList.add('charge-glow');
      await wait(1100);
      tab.classList.remove('charge-glow');
    }
  } finally {
    document.body.classList.remove('charge-touring');
  }
  window.location.hash = target;
}
