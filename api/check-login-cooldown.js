// Pre-login brute-force guard for the master account only (VibeSec
// hardening). auth.js calls this right before attempting the real Supabase
// sign-in, so a source already past the failed-attempt threshold never even
// reaches the real auth call again during its cooldown window.
//
// Always responds with the same { blocked: boolean } shape regardless of
// whether `email` turns out to be the master's account -- for every other
// email (i.e. every student login) this resolves to blocked:false with a
// single cheap lookup, and the response never reveals which case it was, so
// this endpoint can't be used as an oracle to discover which email is the
// master's. Fails open (blocked:false) on any internal error, since a guard
// failure must never itself prevent a real login.
//
// Contract:
//   POST /api/check-login-cooldown
//   body: { email, fingerprint }
//   -> 200 { blocked: boolean }  (always 200)

import { createClient } from '@supabase/supabase-js';

const WINDOW_MINUTES = 15;
const FAILURE_THRESHOLD = 5; // more than this many recent failures => cooldown

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }

  try {
    const blocked = await isSourceInCooldown(req);
    res.status(200).json({ blocked });
  } catch (e) {
    res.status(200).json({ blocked: false });
  }
}

async function isSourceInCooldown(req) {
  const { email, fingerprint } = req.body || {};
  if (!email) return false;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return false;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const normalizedEmail = String(email).trim().toLowerCase();
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .ilike('email', normalizedEmail)
    .maybeSingle();
  if (!targetProfile?.is_admin) return false; // not the master account -- out of scope

  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '').split(',')[0].trim() || null;
  const fp = typeof fingerprint === 'string' && fingerprint ? fingerprint.slice(0, 64) : null;
  if (!ip && !fp) return false;

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

  return Math.max(countIp, countFp) > FAILURE_THRESHOLD;
}
