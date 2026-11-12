// Ambient background music for the vault. Two round buttons, fixed on the
// left edge of the dashboard: a speaker (sound / muted / off-forever) and a
// "change track" button that spins like a coin and shows the new track's
// symbol. Mounted once from dashboard.js, outside #content, so the music
// carries on across every in-dashboard route and never restarts on a
// re-render.
//
// Never in the way: no audio file is requested until the first tap, tracks
// stream (no full decode in memory), the music fades out in lessons (any
// #/.../lesson/... route), while the app is in the background, and while
// any other <video> with sound is playing. Every failure is swallowed -- a
// blocked or missing track must never touch the page.

const TRACKS = [
  { file: 'assets/music/ocean-breath.m4a', symbol: '🌊', name: 'Ocean Breath' },
  { file: 'assets/music/where-the-brave.m4a', symbol: '🪓🛡️', name: 'Where The Brave May Live Forever' },
  { file: 'assets/music/celtic-forest.m4a', symbol: '🌳', name: 'Mystical Celtic Forest' },
  { file: 'assets/music/irish-celtic.m4a', symbol: '☘️', name: 'Irish Celtic Medieval' },
  { file: 'assets/music/deep-focus.m4a', symbol: '👁️', name: 'Deep Focus' },
  { file: 'assets/music/norse-runes.m4a', symbol: '🌌', name: 'Norse Runes' },
  { file: 'assets/music/ancient-door-breath.m4a', symbol: '⚔️', name: 'Ancient Door Breath' },
  { file: 'assets/music/ashen-temple.m4a', symbol: '✊', name: 'Ashen Temple Threshold' },
];

// Files are normalised to -20 LUFS (a calm background level already), so the
// music fades up to full gain and the phone's own volume is what sets the loudness.
const LEVEL = 1;
const INTRO_FADE_MS = 8000; // very slow, gentle fade-in when the music first starts
const FADE_MS = 2500; // coming back from a lesson / unmute
const CROSS_MS = 3000;
const TEASER_DELAY_MS = 7000;

// iOS ignores audio.volume, so volume + fades run through a gain node.
const AudioCtx = window.AudioContext || window.webkitAudioContext;

const svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const SPK = '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/>';
const SPEAKER = {
  on: { icon: svg(SPK + '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'), label: 'מוזיקה פועלת. לחץ להשתקה' },
  muted: { icon: svg(SPK), label: 'מושתק. בכניסה הבאה המוזיקה תחזור. לחץ לכיבוי מלא' },
  off: { icon: svg(SPK + '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>'), label: 'כבוי. לחץ להפעלה' },
};
const ARROWS = svg('<path d="M19 8a7 7 0 0 0-12-2L5 8M5 4v4h4"/><path d="M5 16a7 7 0 0 0 12 2l2-2M19 20v-4h-4"/>');

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) { /* private mode: the preference just won't persist */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const inLesson = () => window.location.hash.split('/').includes('lesson');

export function initAmbientMusic(session) {
  if (!AudioCtx || document.getElementById('amCol')) return;

  const offKey = `vault_music_off_${session.id}`;
  const idxKey = `vault_music_idx_${session.id}`;

  // 'on' | 'muted' | 'off'. Only 'off' is remembered between visits; 'muted'
  // is just for this visit, as agreed.
  let mode = lsGet(offKey) === '1' ? 'off' : 'on';
  let trackIdx = Math.max(0, Math.min(TRACKS.length - 1, parseInt(lsGet(idxKey) || '0', 10) || 0));
  let started = false; // a tap has unlocked audio
  let playing = false; // the music is (meant to be) audible right now
  let ctx = null;
  let slots = [];
  let cur = -1;
  let advancing = false;
  let userChanged = false;
  let busy = false;
  const externalVideos = new Set();

  const col = document.createElement('div');
  col.className = 'am-col';
  col.id = 'amCol';
  col.innerHTML = `
    <button type="button" class="am-btn" id="amSpeaker"><span class="am-coin"><span class="am-face"></span></span></button>
    <button type="button" class="am-btn" id="amChange" aria-label="החלפת מוזיקה" title="החלפת מוזיקה"><span class="am-coin" id="amChangeCoin"><span class="am-face" id="amChangeFace">${ARROWS}</span></span></button>`;
  document.body.appendChild(col);
  const speakerBtn = col.querySelector('#amSpeaker');
  const changeBtn = col.querySelector('#amChange');
  const coin = col.querySelector('#amChangeCoin');
  const face = col.querySelector('#amChangeFace');

  function paintSpeaker() {
    speakerBtn.querySelector('.am-face').innerHTML = SPEAKER[mode].icon;
    speakerBtn.setAttribute('aria-label', SPEAKER[mode].label);
    speakerBtn.title = SPEAKER[mode].label;
    speakerBtn.classList.toggle('is-quiet', mode !== 'on');
  }
  paintSpeaker();

  // ---- audio engine ----

  function ensureEngine() {
    if (ctx) return true;
    try {
      ctx = new AudioCtx();
      slots = [0, 1].map(() => {
        const el = new Audio();
        el.preload = 'none';
        el.setAttribute('playsinline', '');
        const gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(el).connect(gain);
        gain.connect(ctx.destination);
        el.addEventListener('timeupdate', () => onTime(slot));
        el.addEventListener('ended', () => { if (slot === slots[cur]) advance(0.5); });
        const slot = { el, gain, timer: null };
        return slot;
      });
      return true;
    } catch (e) {
      ctx = null;
      return false;
    }
  }

  // Eased (smoothstep, weighted to start slowly) rather than a straight
  // line, so a fade-in begins almost inaudibly and blooms gently.
  function ramp(slot, to, ms) {
    try {
      const g = slot.gain.gain;
      const t = ctx.currentTime;
      const from = g.value;
      g.cancelScheduledValues(t);
      if (ms <= 0 || from === to) { g.setValueAtTime(to, t); return; }
      const N = 64;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1);
        curve[i] = from + (to - from) * Math.pow(x * x * (3 - 2 * x), 1.5);
      }
      g.setValueCurveAtTime(curve, t, ms / 1000);
    } catch (e) { /* ignore */ }
  }

  // The element can report "playing" while the audio context is still
  // suspended by the browser (autoplay policy) -- in that case nothing is
  // audible, so treat it as blocked and wait for the first tap instead.
  async function fadeInWhenAudible(slot, ms) {
    try {
      if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), wait(400)]);
    } catch (e) { /* ignore */ }
    if (ctx.state !== 'running') {
      slot.el.pause();
      playing = false;
      armUnlock();
      return;
    }
    if (playing && slot === slots[cur]) ramp(slot, LEVEL, ms);
  }

  function retireSlot(slot, ms) {
    clearTimeout(slot.timer);
    if (ms <= 0) {
      // backgrounded page: timers are throttled there, so stop right now
      ramp(slot, 0, 0);
      slot.el.pause();
      return;
    }
    ramp(slot, 0, ms);
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => { if (slot !== slots[cur] || !playing) slot.el.pause(); }, ms + 80);
  }

  // Starts `idx` on the idle slot, crossfading out of whatever is playing.
  function playTrack(idx, ms) {
    if (!ensureEngine()) return;
    try { ctx.resume(); } catch (e) { /* ignore */ }
    const old = cur >= 0 ? slots[cur] : null;
    const nextSlotIdx = cur === 0 ? 1 : 0;
    const slot = slots[nextSlotIdx];
    clearTimeout(slot.timer);
    slot.el.src = TRACKS[idx].file;
    slot.el.currentTime = 0;
    cur = nextSlotIdx;
    trackIdx = idx;
    lsSet(idxKey, String(idx));
    advancing = false;
    playing = true;
    const p = slot.el.play();
    if (p && p.then) {
      p.then(() => fadeInWhenAudible(slot, ms)).catch(() => { playing = false; armUnlock(); });
    } else {
      fadeInWhenAudible(slot, ms);
    }
    if (old) retireSlot(old, ms);
    scheduleWarmNext();
  }

  function pauseAll(ms) {
    if (!ctx || !playing) { playing = false; return; }
    playing = false;
    slots.forEach((s) => retireSlot(s, ms));
  }

  function resume(ms) {
    if (!ensureEngine()) return;
    if (cur < 0) { playTrack(trackIdx, ms); return; }
    const slot = slots[cur];
    try { ctx.resume(); } catch (e) { /* ignore */ }
    clearTimeout(slot.timer);
    playing = true;
    const p = slot.el.play();
    if (p && p.then) p.then(() => fadeInWhenAudible(slot, ms)).catch(() => { playing = false; armUnlock(); });
    else fadeInWhenAudible(slot, ms);
  }

  // Auto-advance with a crossfade a few seconds before the track ends.
  function onTime(slot) {
    if (advancing || slot !== slots[cur] || !playing) return;
    const d = slot.el.duration;
    if (!isFinite(d) || d <= 0) return;
    if (d - slot.el.currentTime <= CROSS_MS / 1000 + 0.2) advance(CROSS_MS);
  }
  function advance(ms) {
    if (advancing) return;
    advancing = true;
    const next = (trackIdx + 1) % TRACKS.length;
    playTrack(next, ms);
    flipTo(next, 900);
  }

  // Warms the HTTP cache with the next track a little after this one starts,
  // so the crossfade never waits on the network. Skipped on data-saver / slow links.
  let warmTimer = null;
  function scheduleWarmNext() {
    clearTimeout(warmTimer);
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$|3g/.test(c.effectiveType || ''))) return;
    warmTimer = setTimeout(() => {
      const next = TRACKS[(trackIdx + 1) % TRACKS.length].file;
      fetch(next, { priority: 'low' }).catch(() => {});
    }, 15000);
  }

  // Single place that decides whether music should be audible.
  function reconcile() {
    const away = inLesson();
    col.classList.toggle('is-away', away);
    const should = started && mode === 'on' && !away && !document.hidden && externalVideos.size === 0;
    if (should && !playing) resume(FADE_MS);
    else if (!should && playing) pauseAll(document.hidden ? 0 : away || externalVideos.size ? 900 : 400);
  }

  // ---- first tap: audio can only start from a user gesture ----

  function onFirstGesture(e) {
    if (started) return;
    if (col.contains(e.target)) return; // the buttons handle their own tap
    if (mode === 'off') return;
    unlock();
  }
  function unlock() {
    started = true;
    disarmUnlock();
    if (mode === 'on' && !inLesson() && !document.hidden) playTrack(trackIdx, INTRO_FADE_MS);
  }
  const GESTURES = ['click', 'touchend', 'pointerup', 'keydown'];
  function armUnlock() {
    GESTURES.forEach((g) => document.addEventListener(g, onFirstGesture, true));
    started = false;
  }
  function disarmUnlock() {
    GESTURES.forEach((g) => document.removeEventListener(g, onFirstGesture, true));
  }
  armUnlock();

  // Tries to start by itself right away. Browsers only allow that when the
  // visitor has already interacted with the page / site (desktop Chrome often
  // does after repeat visits); otherwise this stays silent and the first tap
  // anywhere starts it instead (armed above). Either way it fades in slowly.
  function tryAutoplay() {
    const ua = navigator.userActivation;
    if (!ua || !ua.hasBeenActive) return;
    if (mode !== 'on' || inLesson() || document.hidden) return;
    started = true;
    disarmUnlock();
    playTrack(trackIdx, INTRO_FADE_MS);
  }
  tryAutoplay();

  // ---- buttons ----

  speakerBtn.addEventListener('click', () => {
    if (!started && mode === 'on') { unlock(); return; } // first tap just starts the music
    started = true;
    mode = mode === 'on' ? 'muted' : mode === 'muted' ? 'off' : 'on';
    lsSet(offKey, mode === 'off' ? '1' : null);
    paintSpeaker();
    reconcile();
  });

  // Coin flip: the button turns edge-on around its own axis, swaps its face,
  // turns back. It never moves; only the face changes.
  async function turn(html, hold, dur) {
    coin.style.transition = `transform ${dur}ms ease-in`;
    coin.style.transform = 'rotateY(90deg)';
    await wait(dur);
    face.innerHTML = html;
    coin.style.transition = 'none';
    coin.style.transform = 'rotateY(-90deg)';
    void coin.offsetWidth;
    coin.style.transition = `transform ${dur}ms ease-out`;
    coin.style.transform = 'rotateY(0deg)';
    await wait(dur + hold);
  }
  async function spinArrows(turns, ms) {
    const a = face.firstElementChild;
    if (!a) return;
    a.style.transition = `transform ${ms}ms ease`;
    a.style.transform = `rotate(${360 * turns}deg)`;
    await wait(ms + 20);
    a.style.transition = 'none';
    a.style.transform = 'none';
  }
  async function flipTo(idx, hold) {
    if (busy || reducedMotion()) return;
    busy = true;
    try {
      await turn(`<span class="am-emoji${TRACKS[idx].symbol.length > 4 ? ' is-pair' : ''}">${TRACKS[idx].symbol}</span>`, hold, 220);
      await turn(ARROWS, 0, 220);
    } finally { busy = false; }
  }

  changeBtn.addEventListener('click', async () => {
    userChanged = true;
    const next = (trackIdx + 1) % TRACKS.length;
    started = true;
    disarmUnlock();
    if (mode === 'off') {
      // choosing a track is an explicit "I want music": switch back on
      mode = 'on';
      lsSet(offKey, null);
      paintSpeaker();
    }
    if (mode === 'on' && !inLesson()) playTrack(next, 1200);
    else { trackIdx = next; lsSet(idxKey, String(next)); }
    if (busy) return;
    busy = true;
    try {
      if (!reducedMotion()) {
        await spinArrows(1, 450);
        await turn(`<span class="am-emoji${TRACKS[next].symbol.length > 4 ? ' is-pair' : ''}">${TRACKS[next].symbol}</span>`, 1000, 220);
        await turn(ARROWS, 0, 220);
      }
    } finally { busy = false; }
  });

  // A few seconds after arriving, the change button spins through every
  // symbol once, so the student notices it. Skipped once they touch it.
  async function teaser() {
    if (userChanged || busy || mode === 'off' || inLesson() || reducedMotion()) return;
    busy = true;
    try {
      await spinArrows(2, 700);
      for (const t of TRACKS) {
        await turn(`<span class="am-emoji${t.symbol.length > 4 ? ' is-pair' : ''}">${t.symbol}</span>`, 220, 130);
      }
      await turn(ARROWS, 0, 160);
    } finally { busy = false; }
  }
  setTimeout(teaser, TEASER_DELAY_MS);

  // ---- keep out of the way ----

  window.addEventListener('hashchange', reconcile);
  document.addEventListener('visibilitychange', reconcile);
  window.addEventListener('pagehide', () => { if (playing) pauseAll(0); });

  // Any other <video> with sound (trail media, lesson clips) pauses the music
  // for as long as it plays. Our own audio elements are <audio>, never counted.
  const isLoudVideo = (el) => el && el.tagName === 'VIDEO' && !el.muted && el.volume > 0;
  document.addEventListener('play', (e) => {
    if (isLoudVideo(e.target)) { externalVideos.add(e.target); reconcile(); }
  }, true);
  const videoDone = (e) => {
    if (e.target && e.target.tagName === 'VIDEO' && externalVideos.delete(e.target)) reconcile();
  };
  document.addEventListener('pause', videoDone, true);
  document.addEventListener('ended', videoDone, true);

  reconcile();
}
