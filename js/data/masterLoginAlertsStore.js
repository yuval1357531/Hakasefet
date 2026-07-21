// Client for "master_login_alerts" -- brute-force attempts against the
// master account. api/check-login-cooldown.js and api/record-failed-login.js
// (both via the service-role key) are the only two places that ever INSERT
// here; RLS lets is_admin() SELECT and UPDATE (the UPDATE is only ever used
// to mark resolved=true from the "טופל" button below) -- a student can't
// read, forge, or clear these rows even via a direct API call. See
// personalArea.js's securityAlertsHTML for how these render.

import { supabase } from '../supabaseClient.js';

function toAlert(row) {
  return {
    id: row.id,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    ip: row.ip,
    userAgent: row.user_agent,
    deviceType: row.device_type,
    os: row.os,
    browser: row.browser,
    fingerprint: row.fingerprint,
    matchedStudentId: row.matched_student_id,
    matchConfidence: row.match_confidence,
    resolved: row.resolved,
    resolvedAt: row.resolved_at,
  };
}

export const masterLoginAlertsStore = {
  async getActive() {
    const { data, error } = await supabase
      .from('master_login_alerts')
      .select('*')
      .eq('resolved', false)
      .order('last_attempt_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toAlert);
  },

  async getHistory(limit = 100) {
    const { data, error } = await supabase
      .from('master_login_alerts')
      .select('*')
      .eq('resolved', true)
      .order('resolved_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(toAlert);
  },

  async resolve(id) {
    const { error } = await supabase
      .from('master_login_alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  },
};
