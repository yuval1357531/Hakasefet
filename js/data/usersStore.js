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
    },
    createdAt: row.created_at,
    lastLogin: row.last_login,
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
    };
  },

  // Permission/status edits are a plain admin-gated RLS update -- no
  // auth.users involvement, so no serverless function needed here.
  async update(id, changes) {
    const payload = {};
    if (changes.fullName !== undefined) payload.full_name = changes.fullName;
    if (changes.status !== undefined) payload.status = changes.status;
    if (changes.permissions !== undefined) {
      payload.permission_survival_to_freedom = !!changes.permissions.survivalToFreedom;
      payload.permission_vault = !!changes.permissions.vault;
      payload.permission_jaurius_bot = !!changes.permissions.jauriusBot;
    }
    // Note: email/username changes and role changes are intentionally not
    // supported here -- email lives in auth.users (would need its own
    // admin API call), and role/is_admin can only ever be set by hand in
    // the database, never through the app.
    const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).select().single();
    if (error || !data) return null;
    return toUser(data);
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
