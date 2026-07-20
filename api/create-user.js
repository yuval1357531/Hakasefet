// Master-only student creation. This is the one place in the whole app
// that touches the Supabase service-role key -- it must never reach the
// browser. Everything else (reads, permission edits, block/unblock) goes
// through the anon-key client + RLS from the browser directly.
//
// Contract:
//   POST /api/create-user
//   Authorization: Bearer <caller's current Supabase access token>
//   body: { email, password, fullName, permissions, status? }
//   -> 200 { ok: true, user: {...} }
//   -> 401/400/409/500 { ok: false, reason }

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

  // Single service-role client used both to verify the caller's JWT and,
  // once verified as admin, to perform the privileged admin.createUser
  // call -- it bypasses RLS, so the is_admin check below is the only
  // gate standing between "any logged-in user" and "can create accounts".
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

  const { email, password, fullName, permissions, status } = req.body || {};
  if (!email || !password || !fullName || !permissions) {
    res.status(400).json({ ok: false, reason: 'invalid_input' });
    return;
  }
  // Minimum password strength at creation time (reset-password.js already
  // enforces this for resets -- account creation had no check at all).
  if (password.length < 8) {
    res.status(400).json({ ok: false, reason: 'weak_password' });
    return;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError) {
    const isDuplicate = /already registered|already exists/i.test(createError.message || '');
    res.status(isDuplicate ? 409 : 500).json({ ok: false, reason: isDuplicate ? 'email_taken' : 'server_error' });
    return;
  }

  const newUserId = created.user.id;

  // ליווי אישי always implies הכספת access too (never the reverse) --
  // same safety net data/usersStore.js's own update() enforces, applied
  // here too since account creation goes through this endpoint instead.
  const personalGuidance = !!permissions.personalGuidance;
  const { error: insertError } = await admin.from('profiles').insert({
    id: newUserId,
    email,
    full_name: fullName,
    is_admin: false,
    status: status === 'blocked' ? 'blocked' : 'active',
    permission_survival_to_freedom: !!permissions.survivalToFreedom,
    permission_vault: personalGuidance || !!permissions.vault,
    permission_jaurius_bot: !!permissions.jauriusBot,
    permission_personal_guidance: personalGuidance,
  });

  if (insertError) {
    // Compensating action: don't leave an orphaned auth user with no profile.
    await admin.auth.admin.deleteUser(newUserId);
    res.status(500).json({ ok: false, reason: 'server_error' });
    return;
  }

  res.status(200).json({
    ok: true,
    user: {
      id: newUserId,
      email,
      fullName,
      permissions: {
        survivalToFreedom: !!permissions.survivalToFreedom,
        vault: personalGuidance || !!permissions.vault,
        jauriusBot: !!permissions.jauriusBot,
        personalGuidance,
      },
      status: status === 'blocked' ? 'blocked' : 'active',
    },
  });
}
