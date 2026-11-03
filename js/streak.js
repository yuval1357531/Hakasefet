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

// --- student button + popup ------------------------------------------------

export function streakButtonHTML(state) {
  const n = state ? state.currentStreak : 0;
  return `
    <button type="button" class="streak-btn${n > 0 ? ' is-lit' : ''}" id="streakOpenBtn" aria-haspopup="dialog"${state ? '' : ' hidden'}>
      <span class="streak-btn-flame">${ICONS.flame}</span>
      <span class="streak-btn-text">הרצף שלך<span class="streak-btn-count">${n}</span></span>
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

  function paint() {
    body.innerHTML = streakModalBodyHTML({ state, rewards, claimedIds, canClaim: !isDemo });
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
