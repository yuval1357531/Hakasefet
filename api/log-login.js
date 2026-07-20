// Records one login_events row for the CALLING user right after a
// successful login (see auth.js's login()) -- best-effort, never blocks or
// fails the login itself either way. Needs the service-role key only
// because the real client IP is visible to a server (via Vercel's
// x-forwarded-for header), never to browser JS -- everything else
// (device type / OS / browser / a light fingerprint) is parsed client-side
// and simply passed through here alongside it.
//
// Contract:
//   POST /api/log-login
//   Authorization: Bearer <caller's current Supabase access token>
//   body: { deviceType, os, browser, fingerprint }
//   -> 200 { ok: true }
//   -> 401/500 { ok: false, reason }

import { createClient } from '@supabase/supabase-js';

// Hardening (VibeSec): these fields come straight from the client, so cap
// their length and strip control characters before they ever reach the
// DB -- prevents a garbage/oversized value (accidental or deliberate)
// from bloating login_events. Never blocks the login itself; an
// over-limit value is just truncated, same as before with no length check.
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

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ ok: false, reason: 'server_error' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData?.user) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  const { deviceType, os, browser, fingerprint } = req.body || {};
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor || '').split(',')[0].trim() || null;

  await admin.from('login_events').insert({
    user_id: callerData.user.id,
    device_type: sanitizeField(deviceType, 40),
    os: sanitizeField(os, 60),
    browser: sanitizeField(browser, 60),
    device_fingerprint: sanitizeField(fingerprint, 200),
    ip,
    user_agent: sanitizeField(req.headers['user-agent'], 500),
  });

  res.status(200).json({ ok: true });
}
