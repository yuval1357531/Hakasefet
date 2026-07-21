// "היסטוריית התחברויות" -- read side (login_events, admin-only per its own
// RLS) plus the basic multi-device security-alert heuristic. The actual
// LOGGING of each event happens in auth.js (client-side device parsing) +
// api/log-login.js (the one place that can see the real IP) -- this store
// only ever reads what's already been recorded, starting from whenever
// this feature shipped (no retroactive history for logins before it).

import { supabase } from '../supabaseClient.js';

function toEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    deviceType: row.device_type,
    os: row.os,
    browser: row.browser,
    fingerprint: row.device_fingerprint,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

export const loginEventsStore = {
  // Best-effort, fire-and-forget -- never awaited by the login flow itself
  // (see auth.js), so a failure here can never turn a successful login
  // into a stuck/broken one. `token` is the just-established session's own
  // access token (auth.login() has it in hand already; fetching a fresh
  // one via supabase.auth.getSession() right after signInWithPassword can
  // race the client library's own session-write).
  async log(token, { deviceType, os, browser, fingerprint }) {
    if (!token) return;
    try {
      await fetch('/api/log-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deviceType, os, browser, fingerprint }),
      });
    } catch (e) {
      /* best-effort */
    }
  },

  async getForUser(userId, limit = 40) {
    const { data, error } = await supabase
      .from('login_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(toEvent);
  },

  // Admin-only (RLS) -- everyone's events, newest first, used both to list
  // "who logged in when" and to compute the security-alert heuristic below.
  async getAll(limit = 3000) {
    const { data, error } = await supabase
      .from('login_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(toEvent);
  },
};

// A device is identified by its fingerprint when available, falling back
// to a plain "type/os/browser" combo (coarser, but still useful) for
// events logged before a fingerprint existed or when the browser didn't
// support building one. Since deviceInfo.js's fingerprint is itself built
// from device/OS-level signals only (not the raw user agent), a browser
// switch on the SAME phone already resolves to the same key here -- see
// js/deviceInfo.js.
function deviceKey(e) {
  return e.fingerprint || `${e.deviceType || '?'}/${e.os || '?'}/${e.browser || '?'}`;
}

function sourceMetaLabel(e) {
  return [e.browser, e.os].filter(Boolean).join(' · ') || 'לא ידוע';
}

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_72H_MS = 72 * 60 * 60 * 1000;
// How far back a "pattern" is even considered -- a switch older than this
// is just history, never part of a live alert.
const PATTERN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Thresholds a single one-off switch (new phone, new browser, public
// Wi-Fi, a fingerprint that happened to change) never crosses -- only a
// REPEATED pattern of the account's one active session bouncing between
// different sources does. See the comment on computeSecurityAlerts below
// for why "no fingerprint match" alone was never a safe signal on its own.
const HIGH_SWITCHES_72H = 6;
const HIGH_DISTINCT_DAYS = 3;
const NORMAL_SWITCHES_24H = 3;
const NORMAL_SWITCHES_72H = 4;
const NORMAL_DISTINCT_DAYS = 2;

// Multi-device security heuristic -- deliberately NOT "different
// fingerprint = different physical device". A browser has no real
// IMEI/serial/device-id, so a single fingerprint change (browser switch,
// PWA install, cleared storage, new Wi-Fi/IP, a small OS update) can
// legitimately happen to one honest student using their own phone -- that
// must never page the master. What DOES look like account sharing is the
// account's one active session repeatedly bouncing between DIFFERENT
// sources over TIME, not any single switch.
//
// Every login_events row is already exactly one explicit password login
// (see auth.js's login()), which is also exactly the moment the single
// active session moves to whichever device just logged in -- so two
// consecutive rows with a different deviceKey are exactly "the active
// session just moved to a different source," i.e. a real switch. Counting
// and time-windowing those switches (not raw distinct-device counts) is
// the whole fix here. `events` is the admin's full getAll() result;
// `usersById` maps user id -> fullName for the label.
// `usersById` must map ONLY the ids that are allowed to trigger a
// suspicious-usage alert -- callers pass a students-only map (never
// including the master/admin), and any userId not in it here is skipped
// entirely rather than falling back to a placeholder name: this heuristic
// must never fire on the master's own logins/checks, and must never show
// a nameless "משתמש" alert for an unresolved id.
export function computeSecurityAlerts(events, usersById) {
  const byUser = new Map();
  for (const e of events) {
    if (!byUser.has(e.userId)) byUser.set(e.userId, []);
    byUser.get(e.userId).push(e);
  }

  const now = Date.now();
  const alerts = [];

  for (const [userId, userEvents] of byUser) {
    const fullName = usersById.get(userId);
    if (!fullName) continue; // not a real, named student -- never alert on this
    const sorted = [...userEvents].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // A "switch" = a login whose source differs from the immediately
    // preceding login on this SAME account -- the very first login ever
    // is never a switch (nothing to compare it to yet).
    const switches = [];
    for (let i = 1; i < sorted.length; i++) {
      if (deviceKey(sorted[i]) !== deviceKey(sorted[i - 1])) switches.push(sorted[i]);
    }

    const recentSwitches = switches.filter((e) => now - new Date(e.createdAt).getTime() <= PATTERN_WINDOW_MS);
    if (!recentSwitches.length) continue;

    const switches24h = recentSwitches.filter((e) => now - new Date(e.createdAt).getTime() <= WINDOW_24H_MS).length;
    const switches72h = recentSwitches.filter((e) => now - new Date(e.createdAt).getTime() <= WINDOW_72H_MS).length;
    const distinctDays = new Set(recentSwitches.map((e) => new Date(e.createdAt).toISOString().slice(0, 10))).size;

    const isHigh = switches72h >= HIGH_SWITCHES_72H || distinctDays >= HIGH_DISTINCT_DAYS;
    const isNormal = switches24h >= NORMAL_SWITCHES_24H || switches72h >= NORMAL_SWITCHES_72H || distinctDays >= NORMAL_DISTINCT_DAYS;
    if (!isHigh && !isNormal) continue; // 1-2 isolated switches -- history only, never an alert

    const distinctSources = new Set(recentSwitches.map(deviceKey)).size;
    const first = recentSwitches[0];
    const last = recentSwitches[recentSwitches.length - 1];
    const spanMs = new Date(last.createdAt) - new Date(first.createdAt);
    const spanLabel = spanMs < WINDOW_24H_MS ? 'תוך פחות מ-24 שעות' : `לאורך כ-${Math.max(1, Math.round(spanMs / WINDOW_24H_MS))} ימים`;

    // Deliberately never claims certainty about a specific device count
    // ("שני טלפונים") -- a fingerprint difference alone can't prove that.
    const severityLabel = isHigh ? 'התראה גבוהה' : 'התראה רגילה';
    const reason =
      `${severityLabel}: זוהה דפוס שימוש ממקורות שונים לאורך זמן — ` +
      `${recentSwitches.length} החלפות session, ${distinctSources} מקורות שונים, ${spanLabel}. ` +
      `IP אחרון: ${last.ip || 'לא ידוע'}, דפדפן/מערכת אחרונים: ${sourceMetaLabel(last)}`;

    // lastSwitchAt lets the caller (deviceAlertsStore.syncActive) tell a
    // genuinely NEW switch apart from the exact same old pattern still
    // sitting inside the trailing window -- re-running the check without
    // any new login must never bump a count or reopen a resolved alert.
    alerts.push({ userId, fullName, reason, lastSwitchAt: last.createdAt, switchCount: recentSwitches.length });
  }
  return alerts;
}

const CONFIDENCE_LABEL = {
  same: 'כנראה אותו מכשיר',
  maybe: 'ייתכן מכשיר חדש',
  new: 'מכשיר חדש בסבירות גבוהה',
};

// Per-login-event confidence label for loginHistory.js -- compares this
// event's device key (see deviceKey above) to the student's OWN most
// common device key among their other events (the "baseline"). Purely
// informational context next to a login-history row; never used to
// alert/block anything by itself -- computeSecurityAlerts above is what
// actually decides that.
export function deviceConfidenceLabel(event, allUserEvents) {
  const others = allUserEvents.filter((e) => e.id !== event.id);
  if (!others.length) return CONFIDENCE_LABEL.same;

  const counts = new Map();
  for (const e of others) {
    const k = deviceKey(e);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let baselineKey = null;
  let baselineCount = -1;
  for (const [k, c] of counts) {
    if (c > baselineCount) {
      baselineKey = k;
      baselineCount = c;
    }
  }

  const thisKey = deviceKey(event);
  if (thisKey === baselineKey) return CONFIDENCE_LABEL.same;

  const baselineEvent = others.find((e) => deviceKey(e) === baselineKey);
  if (baselineEvent && baselineEvent.deviceType === event.deviceType && baselineEvent.os === event.os) {
    return CONFIDENCE_LABEL.maybe;
  }
  return CONFIDENCE_LABEL.new;
}
