// "הרצף" -- the lever-pull streak + the milestone gifts it unlocks.
// Three tables (see supabase-streak.sql + supabase-streak-lever.sql):
// login_streaks (one row per user, only ever written by the database when the
// daily sentence is saved, i.e. the lever was pulled: server clock, 20h lock,
// once per Israel day, 48h until it runs out),
// streak_rewards (master-defined milestones) and streak_claims (who
// collected which gift). Every call degrades to an empty/null result when
// the tables don't exist yet, so the rest of the page keeps working.

import { supabase } from '../supabaseClient.js';

function toStreak(row) {
  if (!row) return null;
  return {
    currentStreak: row.current_streak ?? row.out_current ?? 0,
    bestStreak: row.best_streak ?? row.out_best ?? 0,
    deadline: row.out_deadline ? new Date(row.out_deadline).getTime() : null,
    // server clock minus this device's clock
    skew: row.out_now ? new Date(row.out_now).getTime() - Date.now() : 0,
  };
}

function toReward(row) {
  return { id: row.id, days: row.days, title: row.title, description: row.description || '', icon: row.icon || 'gift' };
}

function makeId() {
  return 'sr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// "יום 14" next to a student's name (master lists). `day` is null when the
// student has no streak row yet -- nothing is drawn then.
export function dayChipHTML(day, crowned = false) {
  const crown = crowned ? '<span class="student-crown-chip" title="סיים את מסלול בערה"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18L19 8l-4.5 4L12 5l-2.5 7L5 8z"/></svg></span>' : '';
  if (day === null || day === undefined) return crown;
  return `<span class="student-day-chip" title="יום ברצף">יום ${day}</span>${crown}`;
}

export const streakStore = {
  // Master only (RLS): userId -> the streak day the student is on right now.
  // A streak past its deadline is already broken, so it reads 0 until their
  // next lever pull restarts it at 1.
  async getDaysForAll() {
    const { data, error } = await supabase.from('login_streaks').select('user_id, current_streak, deadline_at');
    const map = new Map();
    if (error || !data) return map;
    const now = Date.now();
    data.forEach((r) => map.set(r.user_id, r.deadline_at && new Date(r.deadline_at).getTime() >= now ? r.current_streak : 0));
    return map;
  },

  // The streak as it stands right now (reads only; 0 when it already ran out),
  // or null if the feature isn't set up in the database.
  async getState() {
    const { data, error } = await supabase.rpc('get_streak_state');
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
