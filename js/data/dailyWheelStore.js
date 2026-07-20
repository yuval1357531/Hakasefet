// "מנגנון המשפט היומי" -- a self-contained sentence bank + one-spin-per-24h
// tracker, deliberately separate from the top ticker (highlights tables)
// and from "צידה לדרך" (journal_saved_items): its own two tables,
// 'daily_wheel_sentences' (the bank, master-managed) and
// 'daily_wheel_spins' (one row per user, upserted on every spin -- the
// student's currently-revealed sentence + when they last spun, which is
// also what drives the 24h lock).

import { supabase } from '../supabaseClient.js';

function toSentence(row) {
  return { id: row.id, text: row.text, createdAt: row.created_at };
}

function toSpin(row) {
  if (!row) return null;
  return { sentenceId: row.sentence_id, sentenceText: row.sentence_text, spunAt: row.spun_at };
}

function makeId() {
  return 'dws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const dailyWheelStore = {
  sentences: {
    async getAll() {
      const { data, error } = await supabase.from('daily_wheel_sentences').select('*').order('created_at', { ascending: true });
      if (error || !data) return [];
      return data.map(toSentence);
    },
    async create(text) {
      const { data, error } = await supabase
        .from('daily_wheel_sentences')
        .insert({ id: makeId(), text })
        .select()
        .single();
      if (error || !data) return null;
      return toSentence(data);
    },
    async update(id, text) {
      const { data, error } = await supabase.from('daily_wheel_sentences').update({ text }).eq('id', id).select().single();
      if (error || !data) return null;
      return toSentence(data);
    },
    async remove(id) {
      const { error } = await supabase.from('daily_wheel_sentences').delete().eq('id', id);
      return !error;
    },
  },

  // A user's current spin row, or null if they've never spun yet.
  async getMySpin(userId) {
    const { data, error } = await supabase.from('daily_wheel_spins').select('*').eq('user_id', userId).maybeSingle();
    if (error) return null;
    return toSpin(data);
  },

  // One row per user -- upserted (not inserted) so every spin after the
  // first just overwrites the previous reveal + timestamp.
  async spin({ userId, sentenceId, sentenceText }) {
    const { data, error } = await supabase
      .from('daily_wheel_spins')
      .upsert(
        { user_id: userId, sentence_id: sentenceId, sentence_text: sentenceText, spun_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      .select()
      .single();
    if (error || !data) return null;
    return toSpin(data);
  },
};
