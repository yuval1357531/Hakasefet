// "הרצף שלך עומד להיגמר" -- a small red note for a student whose streak runs
// out within the next 8 hours. The deadline is the server's (48h after the last
// lever pull, see supabase-streak-lever.sql) and is measured on the server's
// clock. Hidden inside a lesson (dashboard.css); gone the moment the lever is
// pulled. The X hides it until the next visit.

import { streakStore } from './data/streakStore.js';

const WARN_MS = 8 * 60 * 60 * 1000;
const RECHECK_MS = 10 * 60 * 1000;

function leftText(ms) {
  const hours = Math.floor(ms / 3600000);
  if (hours >= 2) return `נשארו ${hours} שעות`;
  if (hours === 1) return 'נשארה שעה';
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes === 1 ? 'נשארה דקה' : `נשארו ${minutes} דקות`;
}

export function initStreakWarning() {
  let state = null;
  let el = null;
  let dismissed = false;
  let fetchedAt = 0;

  function paint() {
    const left = state && state.deadline ? state.deadline - (Date.now() + state.skew) : 0;
    const show = !dismissed && state && state.currentStreak > 0 && left > 0 && left <= WARN_MS;
    if (!show) {
      if (el) el.remove();
      el = null;
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'streak-warning';
      el.setAttribute('role', 'status');
      el.innerHTML = `
        <button type="button" class="streak-warning-main"><b>הרצף שלך עומד להיגמר</b><span></span></button>
        <button type="button" class="streak-warning-close" aria-label="סגירה">✕</button>`;
      el.querySelector('.streak-warning-main').addEventListener('click', () => {
        const home = window.location.hash.replace(/^#\/?/, '');
        if (home !== 'me' && home !== '') window.location.hash = '#/me';
        let tries = 0;
        const find = setInterval(() => {
          const wrap = document.querySelector('.streak-wrap');
          tries += 1;
          if (wrap) wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
          if (wrap || tries > 40) clearInterval(find);
        }, 150);
      });
      el.querySelector('.streak-warning-close').addEventListener('click', () => {
        dismissed = true;
        paint();
      });
      document.body.appendChild(el);
    }
    el.querySelector('.streak-warning-main span').textContent = `${leftText(left)}. תפעיל את הידית`;
  }

  async function refresh() {
    fetchedAt = Date.now();
    const fresh = await streakStore.getState().catch(() => null);
    if (fresh) state = fresh;
    paint();
  }

  refresh();
  window.addEventListener('streak:changed', (e) => {
    state = e.detail;
    fetchedAt = Date.now();
    paint();
  });
  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - fetchedAt > RECHECK_MS) refresh();
    else paint();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || Date.now() - fetchedAt < 60000) return;
    dismissed = false;
    refresh();
  });
}
