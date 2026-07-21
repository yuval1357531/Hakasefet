// Lightweight, dependency-free device/browser/OS parsing from
// navigator.userAgent, plus a simple non-cryptographic fingerprint --
// used once, right after a successful login (see auth.js), to feed
// login_events (data/loginEventsStore.js). Deliberately not a real
// browser-fingerprinting library: just enough signal for the master's
// basic "same device or not" security heuristic, nothing that tries to
// survive incognito/clearing storage or identify a specific person.

function detectDeviceType(ua) {
  if (/ipad|tablet(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectOS(ua) {
  if (/windows/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/mac os x/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'לא ידוע';
}

function detectBrowser(ua) {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
  if (/crios\//i.test(ua)) return 'Chrome (iOS)';
  if (/fxios\//i.test(ua)) return 'Firefox (iOS)';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return 'Safari';
  return 'לא ידוע';
}

// A short, stable-per-browser-install hash -- NOT cryptographically
// secure, not meant to be (just needs to differ across distinct
// devices/browsers well enough for the "same device or not" heuristic).
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function getDeviceInfo() {
  const ua = navigator.userAgent || '';
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  })();
  const deviceType = detectDeviceType(ua);
  const os = detectOS(ua);
  // Deliberately built ONLY from device/OS-level signals, never the raw
  // user agent string or browser name -- the raw UA differs completely
  // between Safari and Chrome on the very same physical phone, which used
  // to make the fingerprint (and the multi-device security heuristic built
  // on top of it) see "two phones" for one student switching browsers.
  // detectDeviceType/detectOS already normalize the browser-specific parts
  // of the UA away, so what's left here identifies the PHYSICAL device,
  // not which app opened it.
  const fingerprintSource = [
    deviceType,
    os,
    navigator.language || '',
    tz,
    screen.width + 'x' + screen.height,
    screen.colorDepth || '',
    navigator.hardwareConcurrency || '',
  ].join('|');

  return {
    deviceType,
    os,
    browser: detectBrowser(ua),
    fingerprint: simpleHash(fingerprintSource),
  };
}
