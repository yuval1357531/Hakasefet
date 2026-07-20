// Same JWT-verify-then-service-role shape as create-user.js / delete-user.js.
// Needed because auth.admin.updateUserById is likewise service-role-only --
// today there is NO way for the master to recover a student who forgot or
// mistyped their password (the manage-users edit form disables the password
// field entirely once a user exists), so a lockout there was previously a
// dead end.
//
// Contract:
//   POST /api/reset-password
//   Authorization: Bearer <caller's current Supabase access token>
//   body: { userId, newPassword }
//   -> 200 { ok: true }
//   -> 401/400/500 { ok: false, reason }

import { createClient } from '@supabase/supabase-js';

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

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (profileError || !callerProfile?.is_admin) {
    res.status(401).json({ ok: false, reason: 'unauthorized' });
    return;
  }

  const { userId, newPassword } = req.body || {};
  if (!userId || !newPassword || newPassword.length < 6) {
    res.status(400).json({ ok: false, reason: 'invalid_input' });
    return;
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateError) {
    res.status(500).json({ ok: false, reason: 'server_error' });
    return;
  }

  res.status(200).json({ ok: true });
}
