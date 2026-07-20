// User data layer, now backed by Supabase Auth + the 'profiles' table
// instead of localStorage. Credentials (email/password) live entirely in
// Supabase Auth -- this store only ever sees the profile side (name,
// role, status, permissions). Account CREATE and DELETE go through the
// master-only serverless functions (/api/create-user, /api/delete-user)
// since only those can touch auth.users; permission/status EDITS go
// through a normal admin-gated RLS UPDATE via the anon client.

import { supabase } from '../supabaseClient.js';

function toUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    username: row.email,
    role: row.is_admin ? 'admin' : 'user',
    status: row.status,
    permissions: {
      survivalToFreedom: row.permission_survival_to_freedom,
      vault: row.permission_vault,
      jauriusBot: row.permission_jaurius_bot,
      personalGuidance: row.permission_personal_guidance,
    },
    createdAt: row.created_at,
    lastLogin: row.last_login,
    accessExpiryDate: row.access_expiry_date,
    journalSeenAt: row.journal_seen_by_admin_at,
  };
}

async function currentAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.access_token : null;
}

export const usersStore = {
  async getAll() {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(toUser);
  },

  async getById(id) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return toUser(data);
  },

  async getByUsername(email) {
    const normalized = (email || '').trim().toLowerCase();
    const { data, error } = await supabase.from('profiles').select('*').ilike('email', normalized).maybeSingle();
    if (error || !data) return null;
    return toUser(data);
  },

  async isUsernameTaken(email, excludeId) {
    const normalized = (email || '').trim().toLowerCase();
    const { data, error } = await supabase.from('profiles').select('id').ilike('email', normalized);
    if (error || !data) return false;
    return data.some((row) => row.id !== excludeId);
  },

  // Goes through the master-only serverless function -- the anon client
  // cannot create auth.users rows or set another person's password.
  async create({ fullName, username, password, status, permissions }) {
    const token = await currentAccessToken();
    if (!token) return null;

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: username, password, fullName, permissions, status }),
    });
    const result = await res.json();
    if (!result.ok) return { error: result.reason };

    return {
      id: result.user.id,
      fullName: result.user.fullName,
      username: result.user.email,
      role: 'user',
      status: result.user.status,
      permissions: result.user.permissions,
      createdAt: Date.now(),
      lastLogin: null,
      accessExpiryDate: null,
    };
  },

  // Permission/status edits are a plain admin-gated RLS update -- no
  // auth.users involvement, so no serverless function needed here.
  async update(id, changes) {
    const payload = {};
    if (changes.fullName !== undefined) payload.full_name = changes.fullName;
    if (changes.status !== undefined) payload.status = changes.status;
    if (changes.permissions !== undefined) {
      const personalGuidance = !!changes.permissions.personalGuidance;
      payload.permission_survival_to_freedom = !!changes.permissions.survivalToFreedom;
      // Anyone with ליווי אישי access always gets הכספת access too (the
      // reverse is NOT true) -- enforced here as a safety net even though
      // manageUsers.js's own form already auto-checks/locks the vault
      // checkbox when personalGuidance is checked, so this can never be
      // bypassed by calling usersStore.update directly.
      payload.permission_vault = personalGuidance || !!changes.permissions.vault;
      payload.permission_jaurius_bot = !!changes.permissions.jauriusBot;
      payload.permission_personal_guidance = personalGuidance;
    }
    // accessExpiryDate: 'YYYY-MM-DD' string to set, or null to clear it --
    // undefined means "leave as-is" (not included in this update at all).
    if (changes.accessExpiryDate !== undefined) payload.access_expiry_date = changes.accessExpiryDate;
    // Note: email/username changes and role changes are intentionally not
    // supported here -- email lives in auth.users (would need its own
    // admin API call), and role/is_admin can only ever be set by hand in
    // the database, never through the app.
    const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toUser(data);
  },

  // Master-only visibility (RLS-gated, see "admin reads reset events" on
  // password_reset_events): a lightweight feed of self-service resets so
  // the master notices when a student needed one. profiles(full_name) is
  // a normal PostgREST FK-embed, no join written by hand.
  async getPasswordResetEvents(limit = 20) {
    const { data, error } = await supabase
      .from('password_reset_events')
      .select('id, email, created_at, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.profiles?.full_name || '—',
      createdAt: row.created_at,
    }));
  },

  // Goes through the master-only serverless function -- only auth.admin.*
  // can set another person's password. This is the master's recovery path
  // when a student forgets/mistypes their password: there is no self-serve
  // "forgot password" flow yet, so without this an account is a dead end.
  async resetPassword(id, newPassword) {
    const token = await currentAccessToken();
    if (!token) return false;

    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: id, newPassword }),
    });
    const result = await res.json();
    return !!result.ok;
  },

  // Marks "I (the master) just looked at this student's journal" -- badge
  // bookkeeping only (see studentFolders.js), a plain admin-gated column
  // update, no auth.users involvement.
  async markJournalSeen(id) {
    const { error } = await supabase
      .from('profiles')
      .update({ journal_seen_by_admin_at: new Date().toISOString() })
      .eq('id', id);
    return !error;
  },

  // Goes through the master-only serverless function -- only auth.admin.*
  // can delete an auth.users row (profiles cascades automatically).
  async remove(id) {
    const token = await currentAccessToken();
    if (!token) return false;

    const res = await fetch('/api/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: id }),
    });
    const result = await res.json();
    return !!result.ok;
  },
};
