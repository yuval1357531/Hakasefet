// Same JWT-verify-then-service-role shape as create-user.js. Needed
// because auth.admin.deleteUser is likewise service-role-only --
// manageUsers.js's existing delete button would otherwise silently break.
//
// Contract:
//   POST /api/delete-user
//   Authorization: Bearer <caller's current Supabase access token>
//   body: { userId }
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

  const { userId } = req.body || {};
  if (!userId) {
    res.status(400).json({ ok: false, reason: 'invalid_input' });
    return;
  }

  if (userId === callerData.user.id) {
    res.status(400).json({ ok: false, reason: 'cannot_delete_self' });
    return;
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    res.status(500).json({ ok: false, reason: 'server_error' });
    return;
  }

  res.status(200).json({ ok: true });
}
