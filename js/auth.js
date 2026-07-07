// Session handling, now backed by real Supabase Auth instead of
// usersStore/localStorage. This is the single file that talks to Supabase
// Auth directly -- every other file keeps calling the same functions with
// the same signatures and the same session shape as before, so the blast
// radius of this migration is contained to this one file (plus
// login.html's script, which just calls login()).

import { supabase } from './supabaseClient.js';

const SESSION_KEY = 'vault_session';
const VIEW_MODE_KEY = 'vault_view_mode';

function readSessionCache() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeSessionCache(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

// Builds the exact session shape every other file already expects, from a
// Supabase auth user + their profiles row.
function buildSession(authUser, profile) {
  return {
    id: authUser.id,
    username: authUser.email,
    fullName: profile.full_name,
    role: profile.is_admin ? 'admin' : 'user',
    permissions: {
      survivalToFreedom: profile.permission_survival_to_freedom,
      vault: profile.permission_vault,
      jauriusBot: profile.permission_jaurius_bot,
    },
    loginAt: Date.now(),
  };
}

export const auth = {
  // Validates credentials against Supabase Auth and starts a session.
  // Returns { ok: true, session } or { ok: false, reason: 'invalid' | 'blocked' }.
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return { ok: false, reason: 'invalid' };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, is_admin, status, permission_survival_to_freedom, permission_vault, permission_jaurius_bot')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'invalid' };
    }

    if (profile.status === 'blocked') {
      await supabase.auth.signOut();
      return { ok: false, reason: 'blocked' };
    }

    // Best-effort; not worth failing login over.
    supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', data.user.id).then(() => {});

    const session = buildSession(data.user, profile);
    writeSessionCache(session);
    return { ok: true, session };
  },

  async logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(VIEW_MODE_KEY);
    await supabase.auth.signOut();
  },

  // Stays synchronous -- reads the sessionStorage cache populated at login
  // (or re-hydrated by requireSession()). This is what lets every existing
  // isAdmin()/hasAccess() call site across the app stay untouched.
  getSession() {
    return readSessionCache();
  },

  isAdmin() {
    const session = readSessionCache();
    return !!session && session.role === 'admin';
  },

  hasAccess(sectionId) {
    const session = readSessionCache();
    if (!session) return false;
    if (session.role === 'admin') return true;
    return !!session.permissions[sectionId];
  },

  // Master-only UI toggle: lets the admin browse the site exactly as a
  // regular user would (hiding admin nav/edit affordances, respecting
  // isActive filtering) without logging out or losing their real
  // permissions -- those stay fully intact in the session/DB regardless.
  // Non-admins always resolve to 'user' since the toggle doesn't apply.
  getViewMode() {
    if (!this.isAdmin()) return 'user';
    return sessionStorage.getItem(VIEW_MODE_KEY) === 'user' ? 'user' : 'edit';
  },

  setViewMode(mode) {
    sessionStorage.setItem(VIEW_MODE_KEY, mode === 'user' ? 'user' : 'edit');
  },

  isEditMode() {
    return this.isAdmin() && this.getViewMode() === 'edit';
  },

  // Call at the top of any protected page. Redirects to login when there
  // is no active session and returns null so the caller can bail out.
  async requireSession() {
    const cached = readSessionCache();
    if (cached) return cached;

    // The sessionStorage cache is gone (e.g. tab was closed and reopened),
    // but Supabase's own localStorage-backed session might still be valid
    // -- re-hydrate the cache instead of forcing a needless re-login.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.location.href = 'login.html';
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, is_admin, status, permission_survival_to_freedom, permission_vault, permission_jaurius_bot')
      .eq('id', data.session.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.status === 'blocked') {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
      return null;
    }

    const session = buildSession(data.session.user, profile);
    writeSessionCache(session);
    return session;
  },
};
