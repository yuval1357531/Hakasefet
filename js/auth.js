// Session handling, now backed by real Supabase Auth instead of
// usersStore/localStorage. This is the single file that talks to Supabase
// Auth directly -- every other file keeps calling the same functions with
// the same signatures and the same session shape as before, so the blast
// radius of this migration is contained to this one file (plus
// login.html's script, which just calls login()).

import { supabase } from './supabaseClient.js';
import { loginEventsStore } from './data/loginEventsStore.js';
import { getDeviceInfo } from './deviceInfo.js';

const SESSION_KEY = 'vault_session';
const VIEW_MODE_KEY = 'vault_view_mode';
// Single-active-session enforcement -- EVERY account (students first and
// foremost; the master happens to go through the same mechanism too, but
// isn't the point of it): a fresh explicit password login always wins and
// silently invalidates whatever device held that same account before it.
// Persisted in localStorage (not sessionStorage) so it survives this
// device's own tab being closed and reopened -- otherwise a remembered
// device could never tell it had been superseded.
const ACTIVE_SESSION_KEY = 'vault_active_session_id';

// access_expiry_date is a plain 'YYYY-MM-DD' date, compared against
// today's own date (not a timestamp) so an account expires at the START
// of that day everywhere, regardless of the visitor's local time-of-day.
// Master accounts are never subject to this check, no matter what the
// column holds -- the master must never be able to lock themself out.
function isAccessExpired(profile) {
  if (profile.is_admin) return false;
  if (!profile.access_expiry_date) return false;
  const today = new Date().toISOString().slice(0, 10);
  return profile.access_expiry_date < today;
}

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
      personalGuidance: profile.permission_personal_guidance,
    },
    loginAt: Date.now(),
  };
}

export const auth = {
  // Validates credentials against Supabase Auth and starts a session.
  // Returns { ok: true, session } or { ok: false, reason: 'invalid' | 'blocked' }.
  async login(email, password) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error || !data.session) {
      return { ok: false, reason: 'invalid' };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, is_admin, status, permission_survival_to_freedom, permission_vault, permission_jaurius_bot, permission_personal_guidance, access_expiry_date')
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

    if (isAccessExpired(profile)) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'expired' };
    }

    // Best-effort; not worth failing login over.
    supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', data.user.id).then(() => {});

    // Every account, every EXPLICIT password login (never the silent
    // "זכור אותי" auto-resume, which never calls login() at all -- see
    // requireSession() below) mints a fresh session id and wins outright,
    // silently superseding whatever OTHER device held this same account
    // before it. That other device's own local copy stops matching the
    // very next time it's checked (requireSession() on its next reload, or
    // the periodic pollActiveSession() while it's sitting open) and gets
    // signed out + its own "זכור אותי" cleared, so it must re-enter the
    // password next time -- this is the whole point: a real new login
    // always kicks out any device it didn't come from. One student using
    // two devices over TIME is completely normal (see loginEventsStore's
    // own multi-device heuristic for the actual security-alert judgment
    // call) -- this is only about never letting two devices sit ACTIVE at
    // once on the very same account.
    {
      const newSessionId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
      try { localStorage.setItem(ACTIVE_SESSION_KEY, newSessionId); } catch (e) {}
      // A scoped RPC, not a plain .update() -- profiles has no general
      // "update your own row" RLS policy on purpose (that would let anyone
      // grant themselves is_admin/section permissions via a direct API
      // call), so this can only ever touch active_session_id, nothing else.
      supabase.rpc('set_active_session_id', { new_session_id: newSessionId }).then(() => {});
    }

    // "היסטוריית התחברויות" -- basic device/browser/OS + a light
    // fingerprint, logged from this login onward (see api/log-login.js
    // for why the IP specifically has to be captured server-side). Never
    // awaited: a failure here must never turn a successful login into a
    // stuck one.
    try {
      loginEventsStore.log(data.session.access_token, getDeviceInfo());
    } catch (e) {
      /* best-effort */
    }

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
  // Defaults to 'user' (not 'edit') whenever nothing was chosen yet --
  // e.g. right after a fresh login -- so the master lands in the same
  // experience a student sees, and switches to edit mode manually via
  // the toggle when they actually want to manage content.
  getViewMode() {
    if (!this.isAdmin()) return 'user';
    return sessionStorage.getItem(VIEW_MODE_KEY) === 'edit' ? 'edit' : 'user';
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
      .select('full_name, is_admin, status, permission_survival_to_freedom, permission_vault, permission_jaurius_bot, permission_personal_guidance, access_expiry_date, active_session_id')
      .eq('id', data.session.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.status === 'blocked' || isAccessExpired(profile)) {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
      return null;
    }

    // This is the "זכור אותי" silent auto-resume path (no password was
    // re-entered) for a brand-new tab -- the one place besides the
    // periodic pollActiveSession() poll where a device can discover it's
    // been superseded by a newer explicit login elsewhere. Applies to every
    // account (students first and foremost), not just the master.
    if (kickIfSuperseded(profile.active_session_id)) {
      window.location.href = 'login.html?kicked=1';
      return null;
    }

    const session = buildSession(data.session.user, profile);
    writeSessionCache(session);
    return session;
  },

  // Called on an interval from dashboard.js (see its own comment) for every
  // signed-in session -- catches a device being superseded WHILE it sits
  // open, which requireSession() alone can't: sessionStorage keeps its
  // cache for the whole tab lifetime, so a still-open tab never re-hits
  // the check above until it's closed and reopened.
  async pollActiveSession() {
    const cached = readSessionCache();
    if (!cached) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_session_id')
      .eq('id', cached.id)
      .maybeSingle();
    if (!profile) return;
    if (kickIfSuperseded(profile.active_session_id)) {
      window.location.href = 'login.html?kicked=1';
    }
  },
};

// Shared by requireSession() and pollActiveSession() above. `dbSessionId` is
// the freshly-fetched profiles.active_session_id for this account. Returns
// true (and performs the actual kick: sign out, clear this device's "זכור
// אותי" so the password is required again next time) only when this
// device previously recorded a DIFFERENT session id than what's live now --
// i.e. a genuine newer login happened somewhere else, on ANY account. A
// device with no local record yet (pre-feature, or its very first check)
// simply adopts the current value as its own baseline instead of being
// kicked for no reason.
function kickIfSuperseded(dbSessionId) {
  let localId = null;
  try { localId = localStorage.getItem(ACTIVE_SESSION_KEY); } catch (e) {}
  if (!dbSessionId) return false;
  if (!localId) {
    try { localStorage.setItem(ACTIVE_SESSION_KEY, dbSessionId); } catch (e) {}
    return false;
  }
  if (localId === dbSessionId) return false;

  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(VIEW_MODE_KEY);
  try {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    localStorage.removeItem('vault_remember');
    localStorage.removeItem('vault_remember_user');
  } catch (e) {}
  supabase.auth.signOut();
  return true;
}
