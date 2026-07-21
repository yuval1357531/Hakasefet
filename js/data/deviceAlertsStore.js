// Persisted version of computeSecurityAlerts' (loginEventsStore.js)
// multi-device heuristic -- one active ("טופל"-able) row per flagged
// student in the DB, instead of a value recomputed fresh on every render
// with no identity of its own. RLS restricts every operation to is_admin().

import { supabase } from '../supabaseClient.js';

function toAlert(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    reason: row.reason,
    occurrenceCount: row.occurrence_count,
    lastSeenAt: row.last_seen_at,
    resolved: row.resolved,
    resolvedAt: row.resolved_at,
  };
}

export const deviceAlertsStore = {
  async getActive() {
    const { data, error } = await supabase
      .from('device_alerts')
      .select('*')
      .eq('resolved', false)
      .order('last_seen_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toAlert);
  },

  async getHistory(limit = 100) {
    const { data, error } = await supabase
      .from('device_alerts')
      .select('*')
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(toAlert);
  },

  // Reconciles freshly-computed candidates (computeSecurityAlerts' output,
  // [{userId, fullName, reason}]) against active DB rows: a student already
  // flagged gets their existing row refreshed (occurrence_count bumped,
  // reason/last_seen_at updated); a newly-flagged student gets a new row.
  // Students NOT in `candidates` are left completely untouched -- a
  // previously-flagged student who's no longer detected stays exactly as
  // the master last left them (active or resolved) until they act on it.
  async syncActive(candidates) {
    if (!candidates.length) return;
    const studentIds = candidates.map((c) => c.userId);
    const { data: existing } = await supabase
      .from('device_alerts')
      .select('id, student_id, occurrence_count')
      .in('student_id', studentIds)
      .eq('resolved', false);
    const existingByStudent = new Map((existing || []).map((r) => [r.student_id, r]));
    const nowIso = new Date().toISOString();

    for (const c of candidates) {
      const row = existingByStudent.get(c.userId);
      if (row) {
        await supabase
          .from('device_alerts')
          .update({ reason: c.reason, occurrence_count: row.occurrence_count + 1, last_seen_at: nowIso, updated_at: nowIso })
          .eq('id', row.id);
      } else {
        await supabase.from('device_alerts').insert({ student_id: c.userId, reason: c.reason, occurrence_count: 1, last_seen_at: nowIso });
      }
    }
  },

  async resolve(id) {
    const { error } = await supabase
      .from('device_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  },
};
