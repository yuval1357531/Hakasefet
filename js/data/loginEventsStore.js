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

const MANY_DEVICES_THRESHOLD = 3; // "3 מכשירים שונים ומעלה מכל סוג"

// A device is identified by its fingerprint when available, falling back
// to a plain "type/os/browser" combo (coarser, but still useful) for
// events logged before a fingerprint existed or when the browser didn't
// support building one.
function deviceKey(e) {
  return e.fingerprint || `${e.deviceType || '?'}/${e.os || '?'}/${e.browser || '?'}`;
}

const TYPE_LABEL = {
  mobile: 'טלפונים',
  desktop: 'מחשבים',
  tablet: 'טאבלטים',
};

// Basic heuristic (deliberately simple, per the "לוגיקה בסיסית... לא לבנות
// מערכת אבטחה ענקית" scope) meant to help a master notice likely
// account/password sharing -- never locks anyone out, just surfaces a
// reason string per flagged student. `events` is the admin's full
// getAll() result; `usersById` maps user id -> fullName for the label.
//
// Phone + computer together is normal, everyday use -- never alerts by
// itself. What's actually suspicious is two DIFFERENT devices of the SAME
// broad type (two phones, two computers, ...) for one student, even
// though that's still only 2 devices overall -- that's a much stronger
// account/password-sharing signal than device count alone. Falls back to
// "3 or more distinct devices total" to also catch the case where every
// type only has one device each (phone + computer + tablet, say) but the
// total is still unusually high.
export function computeSecurityAlerts(events, usersById) {
  const byUser = new Map();
  for (const e of events) {
    if (!byUser.has(e.userId)) byUser.set(e.userId, []);
    byUser.get(e.userId).push(e);
  }

  const alerts = [];
  for (const [userId, userEvents] of byUser) {
    const fullName = usersById.get(userId) || 'משתמש';

    const keysByType = new Map();
    const allKeys = new Set();
    for (const e of userEvents) {
      const key = deviceKey(e);
      allKeys.add(key);
      const type = e.deviceType || 'other';
      if (!keysByType.has(type)) keysByType.set(type, new Set());
      keysByType.get(type).add(key);
    }

    let flagged = false;
    for (const [type, keys] of keysByType) {
      if (keys.size >= 2) {
        const label = TYPE_LABEL[type] || 'מכשירים';
        const countWord = keys.size === 2 ? 'שני' : String(keys.size);
        alerts.push({ userId, fullName, reason: `זוהו ${countWord} ${label} שונים לאותו תלמיד` });
        flagged = true;
        break;
      }
    }
    if (flagged) continue;

    if (allKeys.size >= MANY_DEVICES_THRESHOLD) {
      alerts.push({ userId, fullName, reason: `זוהו ${allKeys.size} מכשירים שונים` });
    }
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
