// "מסלול בערה" -- the opening path (see js/chargeDays.js). One row per student
// in burn_paths, only ever written by the database (supabase-burn-path.sql).

import { supabase } from '../supabaseClient.js';

export const burnStore = {
  // Counts whatever can be counted now and returns the path:
  // { started, log: { lessonId: 'YYYY-MM-DD' }, completed, today }.
  // `start` begins the path for this student. null if unavailable.
  async sync(start = false) {
    const { data, error } = await supabase.rpc('burn_sync', { p_start: start });
    if (error || !data) return null;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return null;
    return { started: !!r.out_started, log: r.out_log || {}, completed: !!r.out_completed, today: r.out_today };
  },

  // Master only (RLS): ids of the students who finished the path.
  async getCrowned() {
    const { data, error } = await supabase.from('burn_paths').select('user_id').not('completed_at', 'is', null);
    if (error || !data) return new Set();
    return new Set(data.map((r) => r.user_id));
  },
};
