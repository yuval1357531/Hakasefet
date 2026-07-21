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

  // Reconciles freshly-computed candidates (computeSecurityAlerts' output --
  // [{userId, fullName, reason, lastSwitchAt}]) against DB rows. Re-running
  // "הרץ בדיקת אבטחה" on the SAME old pattern (no new login since it was
  // last recorded) must be a no-op: it must never bump an active alert's
  // count, and must never reopen an alert the master already resolved.
  // `lastSwitchAt` (the timestamp of the actual login that produced this
  // pattern) is what makes that possible -- compared against the stored
  // last_seen_at/resolved_at, it tells a genuinely NEW switch apart from
  // the same historical one still sitting inside computeSecurityAlerts'
  // trailing window. Students NOT in `candidates` are left completely
  // untouched.
  async syncActive(candidates) {
    if (!candidates.length) return;
    const studentIds = candidates.map((c) => c.userId);
    const { data: rows } = await supabase
      .from('device_alerts')
      .select('id, student_id, occurrence_count, resolved, resolved_at, last_seen_at')
      .in('student_id', studentIds);

    const activeByStudent = new Map();
    const lastResolvedByStudent = new Map();
    for (const r of rows || []) {
      if (!r.resolved) {
        activeByStudent.set(r.student_id, r);
      } else {
        const prev = lastResolvedByStudent.get(r.student_id);
        if (!prev || new Date(r.resolved_at) > new Date(prev.resolved_at)) {
          lastResolvedByStudent.set(r.student_id, r);
        }
      }
    }

    const nowIso = new Date().toISOString();
    for (const c of candidates) {
      if (!c.lastSwitchAt) continue; // defensive -- always set by computeSecurityAlerts

      const active = activeByStudent.get(c.userId);
      if (active) {
        // Only a genuinely NEW switch since this alert was last updated
        // bumps the count -- re-checking the exact same old pattern never
        // does.
        if (new Date(c.lastSwitchAt) > new Date(active.last_seen_at)) {
          await supabase
            .from('device_alerts')
            .update({ reason: c.reason, occurrence_count: active.occurrence_count + 1, last_seen_at: c.lastSwitchAt, updated_at: nowIso })
            .eq('id', active.id);
        }
        continue;
      }

      const lastResolved = lastResolvedByStudent.get(c.userId);
      if (lastResolved && new Date(c.lastSwitchAt) <= new Date(lastResolved.resolved_at)) {
        continue; // same old, already-"טופל" pattern -- never reopen it
      }

      // Either never alerted before, or genuinely new activity after the
      // last time this student's alert was resolved.
      await supabase.from('device_alerts').insert({ student_id: c.userId, reason: c.reason, occurrence_count: 1, last_seen_at: c.lastSwitchAt });
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
