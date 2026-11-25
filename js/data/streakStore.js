// "הרצף" -- consecutive-login streak + the milestone gifts it unlocks.
// Three tables (see supabase-streak.sql): login_streaks (one row per user,
// only ever written by the touch_login_streak() database function so the
// day is counted by the SERVER clock, once per Israel calendar day),
// streak_rewards (master-defined milestones) and streak_claims (who
// collected which gift). Every call degrades to an empty/null result when
// the tables don't exist yet, so the rest of the page keeps working.

import { supabase } from '../supabaseClient.js';

function toStreak(row) {
  if (!row) return null;
  return {
    currentStreak: row.current_streak ?? row.out_current ?? 0,
    bestStreak: row.best_streak ?? row.out_best ?? 0,
    lastDay: row.last_day ?? row.out_last_day ?? null,
  };
}

function toReward(row) {
  return { id: row.id, days: row.days, title: row.title, description: row.description || '', icon: row.icon || 'gift' };
}

function makeId() {
  return 'sr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Calendar date (YYYY-MM-DD) in Israel, `offsetDays` from today.
export function israelDate(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(Date.now() + offsetDays * 86400000));
}

// "יום 14" next to a student's name (master lists). `day` is null when the
// student has no streak row yet -- nothing is drawn then.
export function dayChipHTML(day) {
  if (day === null || day === undefined) return '';
  return `<span class="student-day-chip" title="יום ברצף">יום ${day}</span>`;
}

export const streakStore = {
  // Master only (RLS): userId -> the streak day the student is on right now.
  // A streak whose last visit is older than yesterday is already broken, so
  // it reads 0 until their next visit restarts it at 1.
  async getDaysForAll() {
    const { data, error } = await supabase.from('login_streaks').select('user_id, current_streak, last_day');
    const map = new Map();
    if (error || !data) return map;
    const yesterday = israelDate(-1);
    data.forEach((r) => map.set(r.user_id, r.last_day && r.last_day >= yesterday ? r.current_streak : 0));
    return map;
  },

  // Counts today's visit (no-op when already counted today) and returns the
  // up-to-date streak, or null if the feature isn't set up in the database.
  async touch() {
    const { data, error } = await supabase.rpc('touch_login_streak');
    if (error || !data) return null;
    return toStreak(Array.isArray(data) ? data[0] : data);
  },

  rewards: {
    async getAll() {
      const { data, error } = await supabase.from('streak_rewards').select('*').order('days', { ascending: true });
      if (error || !data) return [];
      return data.map(toReward);
    },
    async create({ days, title, description, icon }) {
      const { data, error } = await supabase
        .from('streak_rewards')
        .insert({ id: makeId(), days, title, description, icon })
        .select()
        .single();
      if (error || !data) return null;
      return toReward(data);
    },
    async update(id, { days, title, description, icon }) {
      const { data, error } = await supabase
        .from('streak_rewards')
        .update({ days, title, description, icon })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) return null;
      return toReward(data);
    },
    async remove(id) {
      const { error } = await supabase.from('streak_rewards').delete().eq('id', id);
      return !error;
    },
  },

  claims: {
    async getForUser(userId) {
      const { data, error } = await supabase.from('streak_claims').select('reward_id').eq('user_id', userId);
      if (error || !data) return [];
      return data.map((r) => r.reward_id);
    },
    async claim(userId, rewardId) {
      const { error } = await supabase.from('streak_claims').insert({ user_id: userId, reward_id: rewardId });
      return !error;
    },
    // Master-only: every collected gift, newest first, for the
    // "מי אסף מתנה" list in the master's own management panel.
    async getAll() {
      const { data, error } = await supabase
        .from('streak_claims')
        .select('user_id, reward_id, claimed_at')
        .order('claimed_at', { ascending: false });
      if (error || !data) return [];
      return data.map((r) => ({ userId: r.user_id, rewardId: r.reward_id, claimedAt: r.claimed_at }));
    },
  },
};
