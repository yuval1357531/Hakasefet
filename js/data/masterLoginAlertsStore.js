// Read-only client for "master_login_alerts" -- brute-force attempts
// against the master account. api/check-login-cooldown.js and
// api/record-failed-login.js (both via the service-role key) are the only
// two places that ever write here; RLS restricts SELECT to is_admin() only
// and there is no insert/update/delete policy for any client role at all,
// so a student can't read, forge, or clear these rows even via a direct API
// call. See personalArea.js's securityAlertsHTML for how these render.

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
  };
}

export const masterLoginAlertsStore = {
  async getAll() {
    const { data, error } = await supabase
      .from('master_login_alerts')
      .select('*')
      .order('last_attempt_at', { ascending: false });
    if (error || !data) return [];
    return data.map(toAlert);
  },
};
