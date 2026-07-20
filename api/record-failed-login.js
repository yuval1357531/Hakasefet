// Records ONE failed login attempt against the master account only (never
// students -- rate-limiting/alerting for regular accounts is out of scope
// for this feature) and, once the same source (same IP or same device
// fingerprint) crosses the brute-force threshold within the trailing
// window, upserts a persistent "התראות אבטחה" alert row the master can see
// and act on from personalArea.js. Never receives, stores, or logs the
// attempted password in any form -- only device/IP metadata is ever passed
// here (see auth.js's login()).
//
// Always responds { ok: true } regardless of whether `email` turned out to
// be the master's account or whether anything was actually written, so this
// endpoint can't be used as an oracle to discover which email is the
// master's, and a failure here can never surface to the caller.
//
// Contract:
//   POST /api/record-failed-login
//   body: { email, deviceType, os, browser, fingerprint }
//   -> 200 { ok: true }  (always)

import { createClient } from '@supabase/supabase-js';

const WINDOW_MINUTES = 15;
const FAILURE_THRESHOLD = 5; // more than this many recent failures => alert

function sanitizeField(value, maxLen) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }

  try {
    await recordIfMaster(req);
  } catch (e) {
    /* best-effort -- never let a logging failure surface to the caller */
  }
  res.status(200).json({ ok: true });
}

async function recordIfMaster(req) {
  const { email, deviceType, os, browser, fingerprint } = req.body || {};
  if (!email) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const normalizedEmail = String(email).trim().toLowerCase();
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .ilike('email', normalizedEmail)
    .maybeSingle();
  if (!targetProfile?.is_admin) return; // not the master account -- out of scope

  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '').split(',')[0].trim() || null;
  const ua = sanitizeField(req.headers['user-agent'], 500);
  const cleanDeviceType = sanitizeField(deviceType, 40);
  const cleanOs = sanitizeField(os, 60);
  const cleanBrowser = sanitizeField(browser, 60);
  const fp = sanitizeField(fingerprint, 64);

  await admin.from('failed_master_login_attempts').insert({
    ip,
    user_agent: ua,
    device_type: cleanDeviceType,
    os: cleanOs,
    browser: cleanBrowser,
    fingerprint: fp,
  });

  if (!ip && !fp) return;

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  let countIp = 0;
  if (ip) {
    const { count } = await admin
      .from('failed_master_login_attempts')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)
      .eq('ip', ip);
    countIp = count || 0;
  }

  let countFp = 0;
  if (fp) {
    const { count } = await admin
      .from('failed_master_login_attempts')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)
      .eq('fingerprint', fp);
    countFp = count || 0;
  }

  const attemptCount = Math.max(countIp, countFp);
  if (attemptCount <= FAILURE_THRESHOLD) return; // hasn't crossed the alert threshold yet

  const { matchedStudentId, matchConfidence } = await findMatchingStudent(admin, { ip, fp, browser: cleanBrowser, deviceType: cleanDeviceType });

  const sourceKey = fp || ip;
  const nowIso = new Date().toISOString();
  await admin.from('master_login_alerts').upsert(
    {
      source_key: sourceKey,
      attempt_count: attemptCount,
      last_attempt_at: nowIso,
      ip,
      user_agent: ua,
      device_type: cleanDeviceType,
      os: cleanOs,
      browser: cleanBrowser,
      fingerprint: fp,
      matched_student_id: matchedStudentId,
      match_confidence: matchConfidence,
      updated_at: nowIso,
    },
    { onConflict: 'source_key' }
  );
}

// Looks for the most likely student a suspicious source belongs to, using
// only already-recorded SUCCESSFUL logins (login_events) -- strong match by
// exact device fingerprint, else a looser match by same IP + same
// browser/device type, else no match. Deliberately excludes admin accounts
// from candidates: this must never end up suggesting "block" on the
// master's own profile.
async function findMatchingStudent(admin, { ip, fp, browser, deviceType }) {
  if (fp) {
    const { data: rows } = await admin
      .from('login_events')
      .select('user_id')
      .eq('device_fingerprint', fp)
      .order('created_at', { ascending: false })
      .limit(20);
    const candidate = await firstNonAdminUserId(admin, rows);
    if (candidate) return { matchedStudentId: candidate, matchConfidence: 'strong' };
  }
  if (ip) {
    const { data: rows } = await admin
      .from('login_events')
      .select('user_id, browser, device_type')
      .eq('ip', ip)
      .order('created_at', { ascending: false })
      .limit(20);
    const filtered = (rows || []).filter((r) => (browser && r.browser === browser) || (deviceType && r.device_type === deviceType));
    const candidate = await firstNonAdminUserId(admin, filtered);
    if (candidate) return { matchedStudentId: candidate, matchConfidence: 'partial' };
  }
  return { matchedStudentId: null, matchConfidence: null };
}

async function firstNonAdminUserId(admin, rows) {
  const ids = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
  if (!ids.length) return null;
  const { data: profiles } = await admin.from('profiles').select('id, is_admin').in('id', ids);
  const adminIds = new Set((profiles || []).filter((p) => p.is_admin).map((p) => p.id));
  for (const row of rows || []) {
    if (row.user_id && !adminIds.has(row.user_id)) return row.user_id;
  }
  return null;
}
