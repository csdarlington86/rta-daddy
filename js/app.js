/* ============================================================    RTA Daddy — two-input real time analyzer
   Input 1 and input 2 can be measured at once and overlaid, like a
   measurement mic against a console feed. No SPL metering by design:
   all levels are relative (dBFS).
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- helpers ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clampDB = (v) => (isFinite(v) ? v : -200);

  const FMIN = 20;
  const FMAX = 20000;
  const FREF = 1000;
  const SPAN_LOG = Math.log2(FMAX / FMIN);
  /* AnalyserNode reports Blackman-windowed bin magnitudes. Summing the bins of
     a fractional-octave band recovers the power but lands ~11.2 dB below the
     peak-bin scale, so a full-scale sine read -11.2 dB instead of 0. This is
     the window's coherent-gain (2/0.42) offset minus its ENBW contribution
     (10log10 1.727), and it makes 0 dBFS mean a full-scale sine. */
  const RTA_CAL_DB = 11.2;
  const SPEC_ROWS = 512;
  const MIN_SPAN = 1 / 60;           /* octaves, max zoom */

  const TRACE_COLORS = ['#e53935', '#9ccc65', '#d63ce6', '#40c4ff', '#ffb300', '#26a69a', '#f06292', '#7e57c2'];

  /* Temporal averaging modes. 1-3 are FIFO frame averages: a fixed number of
     FFT analysis frames, oldest dropped first. 4-10 are frequency-weighted
     exponential averages: the low end gets a longer time constant than the
     high end, which keeps room modes readable without smearing cymbals. */
  const AVG_FIFO_FRAMES = { 1: 2, 2: 4, 3: 8 };
  /* Mode 2 is the quick FIFO. At the normal 30 Hz analysis cadence it stays
     exactly four frames; at lower cadences the FIFO window is time-weighted
     so its roughly 133 ms response does not stretch to four slow frames.
     Both the recent median and the current gap must be slow: a lone stall
     must not divert the frames that follow it. */
  const AVG_FAST_TARGET_S = AVG_FIFO_FRAMES[2] / 30;
  const AVG_FAST_EXACT_MIN = 3.5;
  const AVG_FAST_DT_MIN_S = AVG_FAST_TARGET_S / AVG_FAST_EXACT_MIN;
  const AVG_FAST_DT_SAMPLES = 5;
  const AVG_WEIGHTED = {
    4: { lo: 0.25, hi: 0.05 },
    5: { lo: 0.50, hi: 0.08 },
    6: { lo: 1.00, hi: 0.12 },
    7: { lo: 1.80, hi: 0.20 },
    8: { lo: 3.20, hi: 0.35 },
    9: { lo: 5.60, hi: 0.60 },
    10: { lo: 10.00, hi: 1.00 }
  };
  /* Older installs stored none/fast/slow/infinite. Keep Fast, Slow and Inf as
     names so Advanced can show the exact choice; the retired none setting was
     no averaging and is closest to scale 1. */
  const AVG_EFFECTIVE = { fast: '2', slow: '6' };
  const CUSTOM_MS_MIN = 10;
  const CUSTOM_MS_MAX = 60000;
  const CUSTOM_MS_KEYS = ['customLowMs', 'customHighMs', 'customAllMs'];
  const MIC_CAL_KEY = 'rtapro.miccal.v1';
  const TRIM_CHANNELS_VERSION = 2;

  function normalizeAveraging(v) {
    const s = String(v ?? '');
    if (s === 'none') return '1';
    if (s === 'infinite') return 'inf';
    if (s === 'custom' || s === 'fast' || s === 'slow' || s === 'inf') return s;
    const n = Number(s);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? String(n) : '6';
  }

  function normalizeCustomMs(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(Math.round(n), CUSTOM_MS_MIN, CUSTOM_MS_MAX) : fallback;
  }

  function normalizeCustomAvgState() {
    S.customAvgType = S.customAvgType === 'flat' ? 'flat' : 'split';
    S.customLowMs = normalizeCustomMs(S.customLowMs, DEFAULTS.customLowMs);
    S.customHighMs = normalizeCustomMs(S.customHighMs, DEFAULTS.customHighMs);
    S.customAllMs = normalizeCustomMs(S.customAllMs, DEFAULTS.customAllMs);
  }

  function effectiveAveraging(v = S.averaging) {
    return AVG_EFFECTIVE[v] || v;
  }

  /* Fast is the FIFO group, Slow is weighted, and Inf stays Inf. Custom is
     reported as Custom instead of being mislabelled Slow while its curve is
     still driving the average. The saved advanced value is never rewritten. */
  function basicAveraging() {
    const e = effectiveAveraging();
    if (e === 'inf' || e === 'custom') return e;
    return AVG_FIFO_FRAMES[e] ? 'fast' : 'slow';
  }

  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22"><g fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></g></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5l11 7-11 7z"/></svg>';

  /* ---------------- state ---------------- */
  const DEFAULTS = {
    averaging: '6',
    customAvgType: 'split',
    customLowMs: 1000,
    customHighMs: 120,
    customAllMs: 1000,
    banding: 3,
    scale: 'third',
    display: 'bars',
    gridDb: 12,
    lineThickness: 3,
    traceThickness: 2,
    trackPeak: true,
    peakHold: false,
    yOffsetEnabled: false,
    offset: 0,
    specMin: -100,
    specMax: 0,
    specHistory: 1000,
    specSmooth: 0,
    dbTop: 0,
    dbBottom: -96,
    fft: 16384,
    trim: 0,
    trimB: 0,
    showGrid: true,
    showLiveTrace: false,
    targetPreset: 'none',
    targetOffset: 0,
    micId: '',
    trims: {},
    trimsB: {},
    trimsM: {},
    chanMode: 'mix',
    rtaSource: 'a',
    specSource: 'a',
    markA: null,
    markB: null,
    split: 0.42,
    theme: 'dark',
    uiMode: 'easy',
    uiTipSeen: false,
    eqRef: 'auto',
    eqSmooth: 'third',
    eqFormat: 'fg'
  };

  const saved = loadJSON('rtapro.settings.v1', {});
  const S = Object.assign({}, DEFAULTS, saved);
  let micCalibrations = loadJSON(MIC_CAL_KEY, {});
  if (!micCalibrations || typeof micCalibrations !== 'object' || Array.isArray(micCalibrations)) micCalibrations = {};
  // Browser device IDs can be reset or reused. Persist curves, but activate only
  // after the user loads the curve for the currently selected input this session.
  const activeMicCalibrations = Object.create(null);
  let micCalibrationBypassed = false;
  let lastActiveCalibrationKey = '';
  let calibrationGuardDismissed = '';
  let calibrationGuardPreview = null;
  /* Older builds keyed curves by analyzer slot (":a"/":b") or by device only.
     Map them to the device's left/right capture channels. */
  (function migrateMicCalibrationKeys() {
    let changed = false;
    const move = (from, to) => {
      if (from === to || !micCalibrations[from]) return;
      if (!micCalibrations[to]) micCalibrations[to] = micCalibrations[from];
      delete micCalibrations[from];
      changed = true;
    };
    for (const key of Object.keys(micCalibrations)) {
      if (/:a$/.test(key)) move(key, key.slice(0, -2) + ':L');
      else if (/:b$/.test(key)) move(key, key.slice(0, -2) + ':R');
    }
    for (const key of Object.keys(micCalibrations)) {
      if (!/:L$/.test(key) && !/:R$/.test(key)) move(key, key + ':L');
    }
    if (changed) saveMicCalibrations();
  })();
  /* Saved settings from older builds used one trim per analyzer lane. The
     channel-aware format is identified by its trimsM bucket, not by the
     version marker: an old file may have a marker written by an earlier
     startup before this migration ran. A missing trimsM therefore still
     needs the one-time move. */
  if (!S.trims || typeof S.trims !== 'object' || Array.isArray(S.trims)) S.trims = {};
  if (!S.trimsB || typeof S.trimsB !== 'object' || Array.isArray(S.trimsB)) S.trimsB = {};
  S.trimsM = (S.trimsM && typeof S.trimsM === 'object' && !Array.isArray(S.trimsM))
    ? Object.assign({}, S.trimsM) : {};
  const channelAware = saved.trimsM && typeof saved.trimsM === 'object' && !Array.isArray(saved.trimsM);
  if (!channelAware) {
    const finite = (value) => typeof value === 'number' && isFinite(value);
    /* a partial old save can have the active lane value without a bucket; a
       default-zero bucket must not mask that active value */
    const keepTransient = (store, id, value) => {
      if (finite(value) && value !== 0 &&
          (!finite(store[id]) || store[id] === 0)) store[id] = value;
    };
    const id = S.micId || 'default';
    const legacyMode = ['mix', 'L', 'R', 'dual'].indexOf(S.chanMode) >= 0 ? S.chanMode : 'mix';
    if (legacyMode === 'R' || legacyMode === 'mix') {
      const to = legacyMode === 'R' ? S.trimsB : S.trimsM;
      for (const key of Object.keys(S.trims)) {
        const value = S.trims[key];
        /* lane A was the active trim in Right and Mix modes; it wins over a
           stale value left in the target bucket */
        if (finite(value)) to[key] = value;
        delete S.trims[key];
      }
      keepTransient(to, id, S.trim);
    } else if (legacyMode === 'dual') {
      keepTransient(S.trims, id, S.trim);
      keepTransient(S.trimsB, id, S.trimB);
    } else {
      keepTransient(S.trims, id, S.trim);
    }
  }
  if (saved.trimChannelsVersion !== TRIM_CHANNELS_VERSION || !channelAware) {
    S.trimChannelsVersion = TRIM_CHANNELS_VERSION;
    saveSettings();
  }
  /* Persist a migrated value so an installed PWA never opens with an empty
     averaging select. */
  const savedAvg = S.averaging;
  S.averaging = normalizeAveraging(S.averaging);
  normalizeCustomAvgState();
  if (S.averaging !== savedAvg) saveSettings();
  /* The band scale is calibrated 11.2 dB hotter than earlier builds, so the
     old untouched default windows have to move with it. Do that once: this
     check used to run on every load and silently undid a deliberate -12 dBFS
     top or -90/-10 waterfall window after a reload. */
  if (!saved.calVersion) {
    if (S.specMin === -90 && S.specMax === -10) { S.specMin = -100; S.specMax = 0; }
    if (S.dbTop === -12 && S.dbBottom === -96) S.dbTop = 0;
    S.calVersion = 2;
    saveSettings();
  }
  /* markers are absolute frequencies: drop anything that is not a real one */
  if (!isFinite(S.markA) || S.markA < FMIN || S.markA > FMAX) S.markA = null;
  if (!isFinite(S.markB) || S.markB < FMIN || S.markB > FMAX) S.markB = null;
  if (['mix', 'L', 'R', 'dual'].indexOf(S.chanMode) < 0) S.chanMode = 'mix';
  if (S.rtaSource !== 'b') S.rtaSource = 'a';
  if (S.specSource !== 'b') S.specSource = 'a';
  if (S.uiMode !== 'advanced') S.uiMode = 'easy';

  /* older builds shipped two generic tilts and two cinema slopes; point those
     saved settings at a curve that still exists instead of a blank select */
  const TARGET_ALIAS = { live1: 'rock', live3: 'rock', x3: 'cinema', x6: 'cinema' };
  if (TARGET_ALIAS[S.targetPreset]) S.targetPreset = TARGET_ALIAS[S.targetPreset];

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveSettings() {
    try { localStorage.setItem('rtapro.settings.v1', JSON.stringify(S)); } catch (e) {}
  }

  /* ---------------- theme ----------------
     Canvas painting cannot read CSS variables, so the handful of colours that
     fill the plots live here; everything else follows the custom properties. */
  const PAL = {
    dark: {
      bg: '#0b0b0b', plot: '#000', grid: '#232327', minor: '#1e1e22', major: '#2b2b30',
      label: '#83838a', frame: '#2b2b30', spec: '#000',
      specLine: 'rgba(255,255,255,.09)', specFrame: 'rgba(255,255,255,.10)'
    },
    light: {
      bg: '#f2f2ee', plot: '#fbfbf8', grid: '#d5d5cd', minor: '#e6e6df', major: '#c9c9c0',
      label: '#5d5d63', frame: '#c5c5bc', spec: '#fbfbf8',
      specLine: 'rgba(0,0,0,.10)', specFrame: 'rgba(0,0,0,.14)'
    }
  };
  const pal = () => (S.theme === 'light' ? PAL.light : PAL.dark);

  function applyTheme() {
    const light = S.theme === 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f2f2ee' : '#000000');
    gridCache.key = '';
  }

  /* ---------------- dom ---------------- */
  const rtaPanel = $('#rtaPanel');
  const specPanel = $('#specPanel');
  const rtaCanvas = $('#rtaCanvas');
  const specCanvas = $('#specCanvas');
  const rtaCtx = rtaCanvas.getContext('2d');
  const specCtx = specCanvas.getContext('2d');
  const roPeak = $('#roPeak');
  const roLevel = $('#roLevel');
  const rtaInfo = $('#rtaInfo');
  const specInfo = $('#specInfo');
  const avgState = $('#avgState');
  const avgStateText = $('#avgStateText');
  const rewWrap = $('#rewindWrap');
  const rewInput = $('#rewind');
  const rewLabel = $('#rewindLabel');
  const cursorEl = $('#cursor');
  const specCursorEl = $('#specCursor');
  const specCtrlEl = $('#specCtrl');
  const gate = $('#gate');
  const gateMsg = $('#gateMsg');
  const toastEl = $('#toast');
  const toastMsg = $('#toastMsg');
  const toastActionBtn = $('#toastAction');
  const calGuardEl = $('#calGuard');
  const calGuardTextEl = $('#calGuardText');
  const calGuardRelinkBtn = $('#btnCalGuardRelink');
  const calGuardUseBtn = $('#btnCalGuardUse');
  const calGuardDismissBtn = $('#btnCalGuardDismiss');

  /* ---------------- audio ---------------- */
  /* Two analysers live in one context so 1+2 can be split off a stereo
     interface: input 1 is usually the measurement mic, input 2 the console
     feed you want to reference it against. */
  const audio = { ctx: null, a1: null, a2: null, src: null, stream: null, splitter: null, chans: 0, deviceId: '', label: '', gen: 0 };
  let running = false;
  let demoOn = false;
  let rewound = 0;

  /* ---------------- bands ---------------- */
  let bands = [];
  let bandFc = new Float64Array(0);

  function mkChannel() {
    return {
      freq: null,
      raw: new Float32Array(0),
      avg: {
        data: null, sum: null, power: null, scratch: null,
        fifo: null, fifoSum: null, fifoN: 0, fifoPos: 0, fastDt: [], fastSum: null,
        n: 0, ready: false, frames: 0, elapsed: 0
      },
      hold: null
    };
  }
  const CH = { a: mkChannel(), b: mkChannel() };

  /* 1+2 splits a stereo interface into two independent measurements */
  const isDual = () => S.chanMode === 'dual';
  function chanFor(src) { return (isDual() && src === 'b') ? CH.b : CH.a; }
  const rtaChan = () => chanFor(S.rtaSource);
  const specChan = () => chanFor(S.specSource);

  function forEachAnalyser(fn) {
    if (audio.a1) fn(audio.a1);
    if (audio.a2) fn(audio.a2);
  }

  function resetAvg() {
    for (const k of ['a', 'b']) {
      const a = CH[k].avg;
      a.ready = false;
      a.n = 0;
      a.frames = 0;
      a.elapsed = 0;
      a.fifo = null;
      a.fifoSum = null;
      a.fifoN = 0;
      a.fifoPos = 0;
      a.fastDt = [];
      a.fastSum = null;
      a.power = null;
      if (a.sum) a.sum.fill(0);
      CH[k].hold = null;
    }
    settleClear();
  }

  /* ---------------- averaging stability --------------
     The indicator looks at the response actually on screen, not the raw FFT:
     keep a short rolling history of the averaged dB levels, calculate each
     63 Hz - 4 kHz band's variance over that window, and use the 75th
     percentile standard deviation. A single moving tone or a dead band then
     cannot decide the state by itself. This is measurement feedback only; it
     never feeds back into the averaging code. */
  const SETTLE_WINDOW_MS = 2400;
  const SETTLE_MIN_MS = 1800;
  const SETTLE_MIN_SAMPLES = 18;
  const SETTLE_ENTER_DB = 0.5;
  const SETTLE_STAY_DB = 0.8;
  const SETTLE_HOLD_MS = 1000;
  const settle = {
    hist: [], times: [], state: 'idle', settled: false, since: 0,
    metric: 0, samples: 0
  };
  let stableCaptureArmed = false;

  function settleRender() {
    if (!avgState) return;
    const visible = running && !S.paused && settle.state !== 'idle';
    avgState.classList.toggle('hidden', !visible);
    avgState.classList.toggle('settled', settle.state === 'settled');
    avgState.dataset.state = settle.state;
    const txt = settle.state === 'settled' ? 'SETTLED' : 'SETTLING';
    if (avgStateText && avgStateText.textContent !== txt) avgStateText.textContent = txt;
    if (!visible) return;
    const hasMetric = settle.samples >= SETTLE_MIN_SAMPLES;
    const variance = hasMetric ? settle.metric.toFixed(2) : '—';
    if (avgState.dataset.variance !== variance) avgState.dataset.variance = variance;
    avgState.dataset.samples = String(settle.samples);
    avgState.title = hasMetric
      ? (settle.state === 'settled' ? 'Average is settled. ' : 'Average is still settling. ') +
        'Recent per-band variation: ' + variance + ' dB (75th percentile, 63 Hz–4 kHz, ' +
        (SETTLE_WINDOW_MS / 1000).toFixed(1) + ' s).'
      : 'Collecting recent per-band variation over ' + (SETTLE_WINDOW_MS / 1000).toFixed(1) + ' s…';
  }

  function settleClear() {
    settle.hist.length = 0;
    settle.times.length = 0;
    settle.state = 'idle';
    settle.settled = false;
    settle.since = 0;
    settle.metric = 0;
    settle.samples = 0;
    settleRender();
  }

  function settleUpdate(data) {
    if (!running || S.paused || !data || !data.length || !bands.length) return;
    if (data.length !== bands.length) { settleClear(); return; }
    if (settle.hist.length && settle.hist[0].length !== data.length) { settleClear(); return; }

    const now = performance.now();
    settle.hist.push(Float32Array.from(data));
    settle.times.push(now);
    while (settle.times.length > 2 && now - settle.times[0] > SETTLE_WINDOW_MS) {
      settle.hist.shift();
      settle.times.shift();
    }
    settle.samples = settle.hist.length;
    const span = settle.times.length ? now - settle.times[0] : 0;
    if (settle.samples < SETTLE_MIN_SAMPLES || span < SETTLE_MIN_MS) {
      settle.settled = false;
      settle.since = 0;
      settle.metric = 0;
      settle.state = 'settling';
      settleRender();
      return;
    }

    const idx = [];
    for (let i = 0; i < bands.length; i++) {
      if (bands[i].fc >= 63 && bands[i].fc <= 4000) idx.push(i);
    }
    if (!idx.length) { settle.state = 'settling'; settleRender(); return; }

    const n = settle.hist.length;
    const stds = [];
    for (const i of idx) {
      let mean = 0;
      for (const frame of settle.hist) mean += frame[i];
      mean /= n;
      let variance = 0;
      for (const frame of settle.hist) {
        const d = frame[i] - mean;
        variance += d * d;
      }
      stds.push(Math.sqrt(variance / n));
    }
    stds.sort((a, b) => a - b);
    const p75 = stds[Math.min(stds.length - 1, Math.floor((stds.length - 1) * 0.75))];
    settle.metric = p75;

    const qualifies = settle.settled ? p75 <= SETTLE_STAY_DB : p75 <= SETTLE_ENTER_DB;
    if (!qualifies) {
      settle.settled = false;
      settle.since = 0;
    } else if (!settle.settled) {
      if (!settle.since) settle.since = now;
      if (now - settle.since >= SETTLE_HOLD_MS) {
        settle.settled = true;
        if (stableCaptureArmed && running && !S.paused) {
          setStableCaptureArmed(false);
          captureTrace(true);
        }
      }
    }
    settle.state = settle.settled ? 'settled' : 'settling';
    settleRender();
  }

  /* Time constants are precomputed per band when the averaging mode or the
     band grid changes. Low frequencies get the long constant; the top octave
     gets the short one. */
  let avgTau = new Float64Array(0);
  function refreshAvgTau() {
    avgTau = new Float64Array(bands.length);
    const mode = effectiveAveraging();
    if (mode === 'custom') {
      if (S.customAvgType === 'flat') {
        avgTau.fill(normalizeCustomMs(S.customAllMs, DEFAULTS.customAllMs) / 1000);
        return;
      }
      const lo = normalizeCustomMs(S.customLowMs, DEFAULTS.customLowMs) / 1000;
      const hi = normalizeCustomMs(S.customHighMs, DEFAULTS.customHighMs) / 1000;
      const ratio = hi / lo;
      for (let i = 0; i < bands.length; i++) {
        const t = clamp(Math.log2(bands[i].fc / FMIN) / SPAN_LOG, 0, 1);
        avgTau[i] = lo * Math.pow(ratio, t);
      }
      return;
    }
    const p = AVG_WEIGHTED[mode];
    if (!p) return;
    const ratio = p.hi / p.lo;
    for (let i = 0; i < bands.length; i++) {
      const t = clamp(Math.log2(bands[i].fc / FMIN) / SPAN_LOG, 0, 1);
      avgTau[i] = p.lo * Math.pow(ratio, t);
    }
  }

  /* Centres whose band overlaps the 20 Hz - 20 kHz axis, not just centres
     inside it: the old ceil/floor pair ended at 16 kHz, leaving the 20 kHz
     band (and the end of the EQ export) to be sampled from its neighbour. */
  /* Octave centres start at 31.5 Hz; 1/3-octave and finer must start at the
     19.7 Hz centre so the 20 Hz band is present (ISO nominal series). */
  function bandGrid(B) {
    const half = 1 / (2 * B);
    const n0 = B === 1
      ? Math.ceil(Math.log2(FMIN / FREF))
      : Math.floor(Math.log2(FMIN / FREF) * B);
    const nEnd = Math.ceil(Math.log2(FMAX / FREF) * B) + 1;
    const out = [];
    for (let n = n0; n <= nEnd; n++) {
      const fc = FREF * Math.pow(2, n / B);
      if (fc * Math.pow(2, -half) > FMAX) break;
      out.push({
        fc,
        lg: Math.log2(fc),
        lo: fc * Math.pow(2, -half),
        hi: fc * Math.pow(2, half),
        k0: 0,
        k1: 0
      });
    }
    return out;
  }

  function rebuildBands() {
    bands = bandGrid(S.banding);
    bandFc = Float64Array.from(bands.map((b) => b.fc));
    CH.a.raw = new Float32Array(bands.length);
    CH.b.raw = new Float32Array(bands.length);
    mapBands();
    refreshAvgTau();
    resetAvg();
    specReset();
  }

  function mapBands() {
    const sr = audio.ctx ? audio.ctx.sampleRate : 48000;
    mapBins(bands, sr, S.fft);
  }

  /* Bin mapping is separate from the live grid so the self-test can map a copy
     of it at its own sample rate without disturbing a running measurement. */
  function mapBins(list, sr, fft) {
    const df = sr / fft;
    const N = fft / 2;
    const nyq = sr / 2;
    for (const b of list) {
      /* A band that starts at or above Nyquist has no bins to measure. Leaving
         it empty is correct; clamping it to the top bin used to paint a false
         spike at 16-20 kHz on 32 kHz hardware. */
      if (b.lo >= nyq) { b.k0 = -1; b.k1 = -1; continue; }
      let k0 = Math.round(b.lo / df);
      let k1 = Math.round(b.hi / df);
      k0 = clamp(k0, 1, N - 1);
      k1 = clamp(k1, 1, N - 1);
      if (k1 < k0) { k0 = clamp(Math.round(b.fc / df), 1, N - 1); k1 = k0; }
      b.k0 = k0;
      b.k1 = k1;
    }
  }

  function bandLevels(f, out) {
    return levelsFor(bands, f, out);
  }

  function levelsFor(list, f, out) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.k0 < 0) { out[i] = -180; continue; }
      let sum = 0;
      for (let k = b.k0; k <= b.k1; k++) {
        const db = f[k];
        if (db > -180) sum += Math.pow(10, db * 0.1);
      }
      out[i] = (sum > 0 ? 10 * Math.log10(sum) + RTA_CAL_DB : -180);
    }
    return out;
  }

  function ensureAvg(a, n) {
    if (!a.data || a.data.length !== n) {
      a.data = new Float32Array(n);
      a.sum = new Float64Array(n);
      a.scratch = new Float64Array(n);
      a.ready = false;
      a.n = 0;
      a.frames = 0;
      a.elapsed = 0;
      a.fifo = null;
      a.fifoSum = null;
      a.fifoN = 0;
      a.fifoPos = 0;
      a.fastDt = [];
      a.fastSum = null;
      a.power = null;
    } else {
      if (!a.sum || a.sum.length !== n) a.sum = new Float64Array(n);
      if (!a.scratch || a.scratch.length !== n) a.scratch = new Float64Array(n);
    }
  }

  function fifoInit(a, n, len) {
    if (!a.fifo || a.fifo.length !== len || (a.fifo[0] && a.fifo[0].length !== n)) {
      a.fifo = Array.from({ length: len }, () => new Float32Array(n));
      a.fifoSum = new Float64Array(n);
      a.fifoN = 0;
      a.fifoPos = 0;
    }
  }

  function fastWindowFrames(a, dt) {
    if (!a.fastDt) a.fastDt = [];
    a.fastDt.push(clamp(dt || 1 / 30, 0.001, 0.25));
    if (a.fastDt.length > AVG_FAST_DT_SAMPLES) a.fastDt.shift();
    const sorted = a.fastDt.slice().sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    return clamp(AVG_FAST_TARGET_S / median, 1, AVG_FIFO_FRAMES[2]);
  }

  function fastWeightedInto(a, frames) {
    const len = a.fifo.length;
    const n = a.data.length;
    if (!a.fastSum || a.fastSum.length !== n) a.fastSum = new Float64Array(n);
    a.fastSum.fill(0);
    const whole = Math.floor(frames);
    const partial = frames - whole;
    let count = whole + (partial > 0.0001 ? 1 : 0);
    count = Math.max(1, Math.min(count, a.fifoN, len));
    let total = 0;
    let slot = (a.fifoPos - 1 + len) % len;
    for (let k = 0; k < count; k++) {
      let w = 1;
      if (k === count - 1 && partial > 0.0001 && k >= whole) w = partial;
      const frame = a.fifo[slot];
      for (let i = 0; i < n; i++) a.fastSum[i] += frame[i] * w;
      total += w;
      slot = (slot - 1 + len) % len;
    }
    const inv = total > 0 ? 1 / total : 1;
    for (let i = 0; i < n; i++) a.data[i] = powerDb(a.fastSum[i] * inv);
  }

  function powerDb(p) {
    return p > 1e-18 ? 10 * Math.log10(p) : -180;
  }

  /* All averaging is in linear power, not dB: a 20 dB band and a 0 dB band
     must average to the energy actually present, not the arithmetic midpoint
     of their decibel values. */
  function averageInto(a, raw, dt) {
    const n = raw.length;
    ensureAvg(a, n);
    a.frames = (a.frames || 0) + 1;
    a.elapsed = (a.elapsed || 0) + Math.max(0, Number(dt) || 0);
    const power = a.scratch;
    for (let i = 0; i < n; i++) power[i] = Math.pow(10, clampDB(raw[i]) * 0.1);
    const mode = effectiveAveraging();

    if (!a.ready) {
      a.data.set(raw);
      a.ready = true;
      a.n = 1;
      if (mode === 'inf') {
        a.sum.set(power);
      } else if (AVG_FIFO_FRAMES[mode]) {
        fifoInit(a, n, AVG_FIFO_FRAMES[mode]);
        a.fifo[0].set(power);
        a.fifoSum.set(power);
        a.fifoN = 1;
        a.fifoPos = 1 % a.fifo.length;
      } else {
        a.power = Float64Array.from(power);
      }
      return a.data;
    }

    if (mode === 'inf') {
      a.n++;
      for (let i = 0; i < n; i++) a.sum[i] += power[i];
      const inv = 1 / a.n;
      for (let i = 0; i < n; i++) a.data[i] = powerDb(a.sum[i] * inv);
    } else if (AVG_FIFO_FRAMES[mode]) {
      const len = a.fifo.length;
      const slot = a.fifo[a.fifoPos];
      if (a.fifoN < len) a.fifoN++;
      else for (let i = 0; i < n; i++) a.fifoSum[i] -= slot[i];
      slot.set(power);
      for (let i = 0; i < n; i++) a.fifoSum[i] += power[i];
      a.fifoPos = (a.fifoPos + 1) % len;
      const fastFrames = mode === '2' ? fastWindowFrames(a, dt) : null;
      if (fastFrames !== null && fastFrames < AVG_FAST_EXACT_MIN && dt > AVG_FAST_DT_MIN_S) {
        fastWeightedInto(a, fastFrames);
      } else {
        const inv = 1 / a.fifoN;
        for (let i = 0; i < n; i++) a.data[i] = powerDb(a.fifoSum[i] * inv);
      }
    } else {
      if (!a.power || a.power.length !== n) a.power = Float64Array.from(power);
      else {
        const tau = avgTau.length === n ? avgTau : null;
        for (let i = 0; i < n; i++) {
          const t = tau ? tau[i] : 0.25;
          const k = 1 - Math.exp(-Math.max(dt, 0.001) / Math.max(t, 0.01));
          const p = a.power[i] += (power[i] - a.power[i]) * k;
          a.data[i] = powerDb(p);
        }
      }
    }
    return a.data;
  }

  function updatePeakHold(ch) {
    const data = ch.avg.data;
    if (!data) return;
    if (!S.peakHold) { ch.hold = null; return; }
    if (!ch.hold || ch.hold.length !== data.length) {
      ch.hold = Float32Array.from(data);
      return;
    }
    for (let i = 0; i < data.length; i++) if (data[i] > ch.hold[i]) ch.hold[i] = data[i];
  }

  /* linear / log helpers */
  const toU = (f) => (S.scale === 'linear' ? f : Math.log2(f));
  const fromU = (x) => (S.scale === 'linear' ? x : Math.pow(2, x));

  const view = { f0: FMIN, f1: FMAX };

  function resetView() { view.f0 = FMIN; view.f1 = FMAX; gridCache.key = ''; }

  function setViewU(a, b) {
    const lo = toU(FMIN);
    const hi = toU(FMAX);
    let span = b - a;
    span = clamp(span, (hi - lo) * MIN_SPAN, hi - lo);
    let start = (a + b) / 2 - span / 2;
    start = clamp(start, lo, hi - span);
    view.f0 = fromU(start);
    view.f1 = fromU(start + span);
    gridCache.key = '';
  }

  /* ---------------- colormap ---------------- */
  const LUT = (() => {
    const stops = [
      [0.00, [0, 0, 8]], [0.08, [0, 0, 44]], [0.18, [8, 16, 122]], [0.30, [16, 60, 200]],
      [0.42, [0, 150, 190]], [0.52, [10, 180, 70]], [0.62, [40, 200, 0]], [0.72, [150, 215, 0]],
      [0.80, [240, 190, 0]], [0.88, [255, 120, 0]], [0.94, [255, 50, 10]], [1.00, [255, 255, 255]]
    ];
    const out = new Array(256);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const p0 = stops[k][0], c0 = stops[k][1], p1 = stops[k + 1][0], c1 = stops[k + 1][1];
      const f = (t - p0) / Math.max(1e-6, p1 - p0);
      out[i] = [
        Math.round(lerp(c0[0], c1[0], f)),
        Math.round(lerp(c0[1], c1[1], f)),
        Math.round(lerp(c0[2], c1[2], f))
      ];
    }
    return out;
  })();
  /* exact colour → LUT index, so a pixel read back from the waterfall can be
     turned into the level that was drawn there */
  const LUT_KEY = new Map();
  LUT.forEach((c, i) => LUT_KEY.set((c[0] << 16) | (c[1] << 8) | c[2], i));

  /* ---------------- spectrograph ---------------- */
  const spec = { a: null, b: null, w: 0, h: SPEC_ROWS, px: null, dt: 1 / 30 };

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function specReset() {
    spec.a = null; spec.b = null; spec.w = 0; spec.px = null;
  }

  function specEnsure() {
    const BW = S.specHistory * 2;
    if (spec.a && spec.w === BW) return;
    spec.w = BW;
    spec.a = mkCanvas(BW, SPEC_ROWS);
    spec.b = mkCanvas(BW, SPEC_ROWS);
    for (const c of [spec.a, spec.b]) {
      /* the cursor reads pixels back out of these buffers to report the level
         at a historical row, so tell the canvas that up front */
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#000';
      x.fillRect(0, 0, c.width, c.height);
    }
    spec.px = null;
  }

  function specPush(levels, dt) {
    specEnsure();
    const H = SPEC_ROWS;
    const BW = spec.w;
    const src = spec.a;
    const dst = spec.b;
    const dctx = dst.getContext('2d', { willReadFrequently: true });
    dctx.globalCompositeOperation = 'copy';
    dctx.drawImage(src, -1, 0);
    dctx.globalCompositeOperation = 'source-over';

    if (!spec.px) spec.px = dctx.createImageData(1, H);
    const px = spec.px.data;
    const range = Math.max(1, S.specMax - S.specMin);

    for (let r = 0; r < H; r++) {
      /* row 0 is the LOWEST frequency: the buffer is drawn with frequency
         across X, so low frequencies must land on the left edge */
      const t = r / (H - 1);
      const f = FMIN * Math.pow(FMAX / FMIN, t);
      const lvl = clampDB(sampleBands(levels, f));
      let v = (lvl - S.specMin) / range;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      /* gamma: push the noise floor to black so features stand out instead
         of the whole plot sitting in the same green wash */
      v = Math.pow(v, 1.35);
      const c = LUT[(v * 255) | 0];
      const o = r * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    dctx.putImageData(spec.px, BW - 1, 0);
    spec.a = dst; spec.b = src;
    spec.dt = spec.dt * 0.92 + Math.max(dt, 0.001) * 0.08;
  }

  /* The waterfall stores pixels, not samples. Reading the pixel under the
     cursor and inverting the colour map gives the level that row actually had,
     so hovering ten seconds back reports that moment instead of today's live
     level. The image is transposed: display X is a frequency row, display Y is
     a time slice. */
  function specLevelAt(x, y, g) {
    if (!spec.a || !spec.w) return null;
    const H = SPEC_ROWS;
    const BW = spec.w;
    const HW = S.specHistory;
    const sx = clamp(BW - HW - rewound, 0, Math.max(0, BW - HW));
    const rowA = clamp(Math.log2(view.f0 / FMIN) / SPAN_LOG * H, 0, H);
    const rowB = clamp(Math.log2(view.f1 / FMIN) / SPAN_LOG * H, 0, H);
    const rowH = Math.max(0.02, rowB - rowA);
    const bx = Math.round(sx + clamp((y - g.y) / g.h, 0, 1) * HW);
    const by = Math.round(rowA + clamp((x - g.x) / g.w, 0, 1) * rowH);
    let px;
    try {
      px = spec.a.getContext('2d', { willReadFrequently: true }).getImageData(clamp(bx, 0, BW - 1), clamp(by, 0, H - 1), 1, 1).data;
    } catch (e) { return null; }
    const idx = LUT_KEY.get((px[0] << 16) | (px[1] << 8) | px[2]);
    if (idx == null) {
      /* history that has not been written yet is plain black (#000), which is
         below the first LUT stop (0,0,8): report it as silence, not a miss */
      if (px[0] === 0 && px[1] === 0 && px[2] === 0) return S.specMin;
      return null;
    }
    const v = Math.pow(idx / 255, 1 / 1.35);
    return S.specMin + v * (S.specMax - S.specMin);
  }

  function sampleBands(vals, f) {
    if (!bands.length) return -180;
    const idx = (Math.log2(f) - bands[0].lg) * S.banding;
    if (idx <= 0) return vals[0];
    if (idx >= vals.length - 1) return vals[vals.length - 1];
    const i = Math.floor(idx);
    const t = idx - i;
    return vals[i] + (vals[i + 1] - vals[i]) * t;
  }

  function sampleSeries(vals, fcArr, f) {
    if (!fcArr.length) return -180;
    if (f <= fcArr[0]) return vals[0];
    if (f >= fcArr[fcArr.length - 1]) return vals[vals.length - 1];
    let lo = 0, hi = fcArr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fcArr[mid] <= f) lo = mid; else hi = mid;
    }
    const u = Math.log2(f);
    const t = (u - Math.log2(fcArr[lo])) / (Math.log2(fcArr[hi]) - Math.log2(fcArr[lo]));
    return vals[lo] + (vals[hi] - vals[lo]) * t;
  }

  /* ---------------- canvas plumbing ---------------- */
  function fitCanvas(c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = c.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (c.__w !== w || c.__h !== h || c.__dpr !== dpr) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.__w = w; c.__h = h; c.__dpr = dpr;
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gridCache.key = '';
      return true;
    }
    return false;
  }

  const RM = { l: 42, r: 10, t: 22, b: 20 };

  function geomRTA(c) {
    return {
      x: RM.l, y: RM.t,
      w: Math.max(1, c.__w - RM.l - RM.r),
      h: Math.max(1, c.__h - RM.t - RM.b)
    };
  }

  const f2x = (f, g) => {
    const u0 = toU(view.f0), u1 = toU(view.f1);
    return g.x + g.w * (toU(f) - u0) / (u1 - u0);
  };
  const x2f = (x, g) => {
    const u0 = toU(view.f0), u1 = toU(view.f1);
    return fromU(u0 + (x - g.x) / g.w * (u1 - u0));
  };
  const db2y = (db, g) => g.y + g.h * (S.dbTop - db) / (S.dbTop - S.dbBottom);

  /* The spectrograph's buffer is log-spaced in frequency and shows the same
     window as the RTA, but it must stay logarithmic even when the RTA is on
     the linear scale. Using f2x there would put markers and the ruler at the
     wrong columns, so the waterfall has its own pair of mappers. */
  const f2xLog = (f, g) => {
    const u0 = Math.log2(view.f0), u1 = Math.log2(view.f1);
    return g.x + g.w * (Math.log2(clamp(f, FMIN, FMAX)) - u0) / (u1 - u0);
  };
  const x2fLog = (x, g) => {
    const u0 = Math.log2(view.f0), u1 = Math.log2(view.f1);
    return Math.pow(2, u0 + (x - g.x) / g.w * (u1 - u0));
  };

  const fmtHz = (f) => {
    if (f >= 1000) {
      const k = f / 1000;
      return (Math.abs(k - Math.round(k)) < 0.05 ? Math.round(k) : k.toFixed(1)) + 'k';
    }
    if (f >= 100) return String(Math.round(f));
    return String(Math.round(f * 10) / 10);
  };
  const fmtDb = (v) => (isFinite(v) ? v.toFixed(1) : '—') + ' dB';
  /* An exact frequency, never snapped to the nearest band centre: dragging the
     cursor must read the frequency the line is actually on (200, 213, 227…),
     not the 1/3-octave nominal value underneath it. */
  function fmtHzCursor(f) {
    if (!isFinite(f)) return '—';
    if (f < 100) return (Math.round(f * 10) / 10).toFixed(1);
    return String(Math.round(f));
  }
  /* isFinite(null) is true, which quietly treats an unset marker as 0 Hz:
     every marker check goes through this instead. */
  const numMark = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

  /* ---------------- grid (cached) ---------------- */
  const gridCache = { key: '', canvas: null };

  function freqTicks() {
    const out = [];
    const inView = (f) => f >= view.f0 * 0.999 && f <= view.f1 * 1.001;
    if (S.scale === 'linear') {
      const span = view.f1 - view.f0;
      const step = niceStep(span / 8);
      const start = Math.ceil(view.f0 / step) * step;
      for (let f = start; f <= view.f1; f += step) out.push({ f, label: true });
    } else if (S.scale === 'decade') {
      for (let d = 10; d <= 20000; d *= 10) {
        for (let m = 1; m <= 9; m++) {
          const f = d * m;
          if (inView(f)) out.push({ f, label: m === 1 });
        }
      }
    } else {
      const per = S.scale === 'third' ? 3 : 1;
      const n0 = Math.ceil(Math.log2(view.f0 / FREF) * per);
      const n1 = Math.floor(Math.log2(view.f1 / FREF) * per);
      for (let n = n0; n <= n1; n++) {
        const f = FREF * Math.pow(2, n / per);
        if (per === 3) out.push({ f, label: n % 3 === 0 });
        else out.push({ f, label: true });
      }
    }
    return out;
  }

  /* log-spaced ruler for the spectrograph, independent of the RTA's scale */
  function logTicks() {
    const out = [];
    const inView = (f) => f >= view.f0 * 0.999 && f <= view.f1 * 1.001;
    for (let n = Math.ceil(Math.log2(view.f0 / FREF) * 3); n <= Math.floor(Math.log2(view.f1 / FREF) * 3); n++) {
      const f = FREF * Math.pow(2, n / 3);
      if (inView(f)) out.push({ f, label: n % 3 === 0 });
    }
    return out;
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * p;
  }

  const PREF = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
    1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

  function prefHz(f) {
    let best = PREF[0], bd = Infinity;
    for (const p of PREF) {
      const d = Math.abs(Math.log2(p / f));
      if (d < bd) { bd = d; best = p; }
    }
    return Math.abs(Math.log2(best / f)) < 0.12 ? best : f;
  }

  function paintGrid(ctx, g) {
    const W = g.x + g.w + RM.r;
    ctx.font = '10px system-ui,-apple-system,Roboto,sans-serif';
    ctx.textBaseline = 'middle';

    ctx.strokeStyle = pal().grid;
    ctx.lineWidth = 1;

    /* horizontal (level) */
    const top = Math.floor(S.dbTop / S.gridDb) * S.gridDb;
    for (let db = top; db >= S.dbBottom; db -= S.gridDb) {
      const y = Math.round(db2y(db, g)) + 0.5;
      if (y < g.y - 1 || y > g.y + g.h + 1) continue;
      ctx.beginPath(); ctx.moveTo(g.x, y); ctx.lineTo(g.x + g.w, y); ctx.stroke();
      ctx.fillStyle = pal().label;
      ctx.textAlign = 'right';
      ctx.fillText(String(db), g.x - 6, y);
    }

    /* vertical (frequency) */
    if (S.showGrid) {
      const ticks = freqTicks();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let lastRight = -1e9;
      for (const t of ticks) {
        const x = Math.round(f2x(t.f, g)) + 0.5;
        if (x < g.x - 1 || x > g.x + g.w + 1) continue;
        ctx.strokeStyle = t.label ? pal().major : pal().minor;
        ctx.beginPath(); ctx.moveTo(x, g.y); ctx.lineTo(x, g.y + g.h); ctx.stroke();
        if (t.label) {
          const txt = fmtHz(prefHz(t.f));
          const w = ctx.measureText(txt).width;
          /* octave labels like "12.5k" overlap once the plot gets narrow:
             drop a label rather than let them collide */
          if (x - w / 2 >= lastRight + 6) {
            lastRight = x + w / 2;
            ctx.fillStyle = pal().label;
            ctx.fillText(txt, x, g.y + g.h + 4);
          }
        }
      }
    }

    /* frame */
    ctx.strokeStyle = pal().frame;
    ctx.strokeRect(g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1);
  }

  function drawGridLayer(ctx, c, g) {
    const key = [c.__w, c.__h, c.__dpr, g.x, g.y, g.w, g.h, S.dbTop, S.dbBottom, S.gridDb,
      S.scale, S.showGrid, S.theme, view.f0.toFixed(3), view.f1.toFixed(3)].join('|');
    if (gridCache.key !== key || !gridCache.canvas) {
      const cv = mkCanvas(Math.round(c.__w * c.__dpr), Math.round(c.__h * c.__dpr));
      const gctx = cv.getContext('2d');
      gctx.setTransform(c.__dpr, 0, 0, c.__dpr, 0, 0);
      paintGrid(gctx, g);
      gridCache.key = key;
      gridCache.canvas = cv;
    }
    ctx.drawImage(gridCache.canvas, 0, 0, c.__w, c.__h);
  }

  /* ---------------- traces ---------------- */
  function traceAveragingMeta(ch, overrides) {
    const mode = effectiveAveraging();
    const kind = mode === 'inf' ? 'infinite' : (AVG_FIFO_FRAMES[mode] ? 'fifo' : 'weighted');
    let timeConstants = null;
    if (kind === 'weighted' && avgTau.length) {
      const perBandSeconds = Array.from(avgTau, (v) => +(+v).toFixed(6));
      timeConstants = {
        lowSeconds: perBandSeconds[0],
        highSeconds: perBandSeconds[perBandSeconds.length - 1],
        perBandSeconds
      };
    }
    const elapsed = overrides && isFinite(overrides.elapsedSeconds)
      ? overrides.elapsedSeconds : (ch.avg.elapsed || 0);
    const frames = overrides && isFinite(overrides.frameCount)
      ? overrides.frameCount : (ch.avg.frames || 0);
    return {
      mode,
      kind,
      timeConstants,
      elapsedSeconds: +Math.max(0, elapsed).toFixed(3),
      frameCount: Math.max(0, Math.round(frames))
    };
  }

  let traces = loadJSON('rtapro.traces.v1', []);
  if (!Array.isArray(traces)) traces = [];
  let selected = new Set();
  let captureCount = traces.length;

  function saveTraces() {
    try { localStorage.setItem('rtapro.traces.v1', JSON.stringify(traces)); } catch (e) { toast('Storage full — export first'); }
  }

  function captureTrace(fromSettled) {
    /* A manual Capture supersedes any armed wait: one tap must not leave a
       second automatic capture queued behind it. */
    const cancelledWait = fromSettled !== true && stableCaptureArmed;
    if (cancelledWait) setStableCaptureArmed(false);
    /* capture whatever the RTA is showing, so a capture in 1+2 is unambiguous */
    const ch = rtaChan();
    if (!ch.avg.ready) { toast('Start a measurement first'); return; }
    const tag = isDual() ? (S.rtaSource === 'b' ? ' (IN2)' : ' (IN1)') : '';
    const t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: (fromSettled === true ? 'Settled ' : 'Capture ') + (++captureCount) + tag,
      color: TRACE_COLORS[traces.length % TRACE_COLORS.length],
      offset: 0,
      visible: true,
      freqs: bands.map((b) => +b.fc.toFixed(3)),
      levels: Array.from(ch.avg.data, (v) => +(+v).toFixed(2)),
      averaging: traceAveragingMeta(ch)
    };
    traces.push(t);
    saveTraces();
    renderTraces();
    toast((fromSettled === true ? 'Settled · captured ' :
      (cancelledWait ? 'Wait cancelled · captured ' : 'Captured ')) + t.name);
  }

  function setStableCaptureArmed(on) {
    stableCaptureArmed = !!on;
    const drawerBtn = $('#btnCaptureStable');
    const mainBtn = $('#btnCaptureStableMain');
    const title = stableCaptureArmed
      ? 'Waiting for the average to settle — press to cancel'
      : 'Wait until the RTA average is settled, then capture it';
    if (drawerBtn) {
      drawerBtn.textContent = stableCaptureArmed ? 'Cancel wait' : 'Capture when settled';
      drawerBtn.classList.toggle('waiting', stableCaptureArmed);
      drawerBtn.setAttribute('aria-pressed', String(stableCaptureArmed));
      drawerBtn.title = title;
    }
    if (mainBtn) {
      mainBtn.textContent = stableCaptureArmed ? 'Cancel' : 'When settled';
      mainBtn.classList.toggle('waiting', stableCaptureArmed);
      mainBtn.setAttribute('aria-pressed', String(stableCaptureArmed));
      mainBtn.setAttribute('aria-label', stableCaptureArmed
        ? 'Cancel waiting to capture when settled'
        : 'Capture when the average settles');
      mainBtn.title = title;
    }
    const moreStable = $('#btnCaptureStableMore');
    if (moreStable) {
      moreStable.textContent = stableCaptureArmed ? 'Cancel wait' : 'When settled';
      moreStable.classList.toggle('waiting', stableCaptureArmed);
      moreStable.setAttribute('aria-pressed', String(stableCaptureArmed));
      moreStable.title = title;
    }
    const moreBtn = $('#btnMore');
    if (moreBtn) {
      moreBtn.classList.toggle('waiting', stableCaptureArmed);
      moreBtn.title = stableCaptureArmed
        ? 'More actions \u2014 waiting for the average to settle'
        : 'More actions';
      moreBtn.setAttribute('aria-label', stableCaptureArmed
        ? 'More actions \u2014 waiting for the average to settle'
        : 'More actions');
    }
  }

  function toggleStableCapture() {
    if (stableCaptureArmed) {
      setStableCaptureArmed(false);
      toast('Stable capture cancelled');
      return;
    }
    if (!running) { toast('Start a measurement first'); return; }
    if (S.paused) { toast('Resume the measurement first'); return; }
    if (settle.settled) { captureTrace(true); return; }
    setStableCaptureArmed(true);
    toast('Waiting for the average to settle — press Cancel to stop');
  }

  function averageSelected() {
    const sel = selected.size ? traces.filter((t) => selected.has(t.id)) : traces.slice();
    if (!sel.length) { toast('Capture something first'); return; }
    const freqs = bands.map((b) => b.fc);
    const levels = freqs.map((f) => {
      let sum = 0;
      for (const t of sel) sum += sampleSeries(t.levels, t.freqs, f);
      return +(sum / sel.length).toFixed(2);
    });
    const t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: sel.length === 1 ? sel[0].name + ' (copy)' : 'Average ' + sel.length,
      color: TRACE_COLORS[traces.length % TRACE_COLORS.length],
      offset: 0, visible: true, freqs, levels
    };
    traces.push(t);
    saveTraces();
    renderTraces();
    toast('Averaged ' + sel.length + ' trace' + (sel.length > 1 ? 's' : ''));
  }

  /* ---- averaged reference capture ----
     Records the running average for N seconds in linear power, so the stored
     reference is what the room did over time, not one frame of it. */
  let avgRec = null;

  function captureAverage() {
    if (avgRec) { stopAverage(false); return; }
    if (!running) { toast('Start a measurement first'); return; }
    const ch = rtaChan();
    if (!ch.avg.ready) { toast('Start a measurement first'); return; }
    const sel = $('#avgSecs');
    const secs = clamp(Number(sel && sel.value) || 10, 1, 300);
    avgRec = { secs, ms: secs * 1000, t0: performance.now(), sum: null, n: 0, meta: traceAveragingMeta(ch) };
    const b = $('#btnCaptureAvg');
    if (b) { b.textContent = 'Cancel ' + secs + 's'; b.classList.add('warn'); }
    toast('Averaging ' + secs + ' s…');
  }

  function avgAccumulate() {
    if (!avgRec) return;
    const d = rtaChan().avg.data;
    if (!d) return;
    if (!avgRec.sum || avgRec.sum.length !== d.length) avgRec.sum = new Float64Array(d.length);
    for (let i = 0; i < d.length; i++) avgRec.sum[i] += Math.pow(10, d[i] / 10);
    avgRec.n++;
    const left = Math.max(0, Math.ceil((avgRec.ms - (performance.now() - avgRec.t0)) / 1000));
    const b = $('#btnCaptureAvg');
    if (b && left > 0) b.textContent = 'Cancel ' + left + 's';
    if (performance.now() - avgRec.t0 >= avgRec.ms) stopAverage(true);
  }

  function stopAverage(save) {
    if (!avgRec) return;
    const rec = avgRec;
    avgRec = null;
    const b = $('#btnCaptureAvg');
    if (b) { b.textContent = 'Record'; b.classList.remove('warn'); }
    if (!save) { toast('Average cancelled'); return; }
    if (!rec.n || !rec.sum) { toast('No data to average'); return; }
    const tag = isDual() ? (S.rtaSource === 'b' ? ' (IN2)' : ' (IN1)') : '';
    const levels = Array.from(rec.sum, (s) => +(10 * Math.log10(Math.max(s / rec.n, 1e-12))).toFixed(2));
    const averaging = Object.assign({}, rec.meta, {
      elapsedSeconds: +((performance.now() - rec.t0) / 1000).toFixed(3),
      frameCount: rec.n
    });
    const t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: 'Avg ' + rec.secs + 's ' + (++captureCount) + tag,
      color: TRACE_COLORS[traces.length % TRACE_COLORS.length],
      offset: 0, visible: true,
      freqs: bands.map((b2) => +b2.fc.toFixed(3)),
      levels,
      averaging
    };
    traces.push(t);
    saveTraces();
    renderTraces();
    toast('Averaged ' + rec.secs + ' s → ' + t.name);
  }

  /* Removing traces is one tap: either the × on the row, the Delete button for
     the ticked rows, or Clear. The last removal can always be undone. */
  let lastDeleted = null;
  let clearArmed = 0;

  function removeTraces(ids) {
    const drop = new Set(ids);
    const keep = [];
    const gone = [];
    for (const t of traces) {
      if (drop.has(t.id)) gone.push(t); else keep.push(t);
    }
    if (!gone.length) return 0;
    traces = keep;
    selected.clear();
    lastDeleted = gone;
    saveTraces();
    renderTraces();
    return gone.length;
  }

  function updateUndoBtn() {
    const b = $('#btnUndo');
    if (b) b.disabled = !(lastDeleted && lastDeleted.length);
  }

  function deleteSelected() {
    if (!selected.size) { toast('Tap a row to select it, or use its ×'); return; }
    const n = removeTraces(Array.from(selected));
    toast('Deleted ' + n + ' trace' + (n === 1 ? '' : 's'));
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function traceAveragingTitle(t) {
    const a = t.averaging;
    if (!a) return '';
    const parts = ['Averaging ' + String(a.mode || '?')];
    if (a.kind) parts.push(String(a.kind));
    if (a.timeConstants) {
      const low = Number(a.timeConstants.lowSeconds);
      const high = Number(a.timeConstants.highSeconds);
      if (Number.isFinite(low) && Number.isFinite(high)) parts.push(low + '–' + high + ' s');
    }
    const elapsed = Number(a.elapsedSeconds);
    if (Number.isFinite(elapsed)) parts.push(elapsed.toFixed(1) + ' s');
    const frames = Number(a.frameCount);
    if (Number.isFinite(frames)) parts.push(Math.round(frames) + ' frames');
    return parts.join(' · ');
  }

  function renderTraces() {
    const list = $('#traceList');
    const badge = $('#traceBadge');
    if (badge) badge.textContent = String(traces.length);
    const moreBadge = $('#traceBadgeMore');
    if (moreBadge) moreBadge.textContent = String(traces.length);
    if (!traces.length) {
      list.innerHTML = '<p class="empty">No captured traces yet. Hit Capture to store the current response.</p>';
      updateUndoBtn();
      return;
    }
    list.innerHTML = '';
    traces.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'traceRow' + (selected.has(t.id) ? ' sel' : '');
      row.dataset.id = t.id;
      row.title = traceAveragingTitle(t);
      row.innerHTML =
        '<label><input type="checkbox" class="tShow"' + (t.visible ? ' checked' : '') + '></label>' +
        '<input type="text" class="tName" value="' + esc(t.name) + '" maxlength="28">' +
        '<input type="number" class="tOff" value="' + t.offset + '" step="1" min="-60" max="60">' +
        '<input type="color" class="tColor" value="' + t.color + '">' +
        '<button class="tDel" title="Delete this trace" aria-label="Delete trace">✕</button>';
      list.appendChild(row);

      row.querySelector('.tDel').addEventListener('click', (e) => {
        e.stopPropagation();
        if (removeTraces([t.id])) toast('Deleted ' + t.name);
      });

      row.querySelector('.tShow').addEventListener('change', (e) => {
        t.visible = e.target.checked; saveTraces();
      });
      row.querySelector('.tName').addEventListener('input', (e) => {
        t.name = e.target.value; saveTraces();
      });
      row.querySelector('.tOff').addEventListener('input', (e) => {
        t.offset = Number(e.target.value) || 0; saveTraces();
      });
      row.querySelector('.tColor').addEventListener('input', (e) => {
        t.color = e.target.value; saveTraces();
      });
      row.addEventListener('click', (e) => {
        if (e.target.matches('input')) return;
        if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id);
        row.classList.toggle('sel', selected.has(t.id));
      });
    });
    updateUndoBtn();
  }

  /* ---------------- target curve ---------------- */
  let customCurve = loadJSON('rtapro.curve.v1', null);

  /* Target curves, not invented shapes. Each preset is a small parameter set
     built around what system techs actually aim for at FOH:
       - speech, theatre and corporate run essentially flat with the top octave
         allowed to fall away and no sub shelf
       - music targets carry a low-frequency shelf, and its size (63 Hz relative
         to 1 kHz) is the biggest taste variable between genres: rock sits
         4-6 dB up below ~60 Hz, EDM digs deeper still
       - the cinema X-curve is a standard: flat to 2 kHz, then a fixed slope,
         with a 3 dB/oct roll-off below 63 Hz
     Only the shape matters: alignCurve() slides the whole curve onto the
     measured data, so the same preset works whatever level the mic delivers. */
  const TARGETS = {
    flat: {
      name: 'Flat', tag: 'Reference', genre: 'Reference',
      note: '0 dB everywhere — judge the system, not the taste',
      sub: 0, subF: 60, tilt: 0, tiltF: 1000, hf: 0, hfF: 12000, hp: 0, hpF: 63
    },
    speech: {
      name: 'Speech', tag: 'Speech', genre: 'Corporate / theatre',
      note: 'no sub shelf, 1 dB/oct above 4 kHz, extra top-octave roll',
      sub: 0, subF: 60, tilt: 1, tiltF: 4000, hf: 2, hfF: 12000, hp: 0, hpF: 63
    },
    acoustic: {
      name: 'Acoustic', tag: 'Acoustic', genre: 'Jazz / folk / classical',
      note: 'small 2 dB shelf below 90 Hz, 1 dB/oct from 5 kHz',
      sub: 2, subF: 90, tilt: 1, tiltF: 5000, hf: 1.5, hfF: 12000, hp: 0, hpF: 40
    },
    pop: {
      name: 'Pop', tag: 'Pop', genre: 'Top 40 / corporate party',
      note: '+3 dB shelf below 80 Hz, 1 dB/oct from 3 kHz',
      sub: 3, subF: 80, tilt: 1, tiltF: 3000, hf: 1.5, hfF: 11000, hp: 0, hpF: 40
    },
    rock: {
      name: 'Rock', tag: 'Rock', genre: 'Club / live band',
      note: '+4 dB shelf below 80 Hz, 1.2 dB/oct from 1 kHz',
      sub: 4, subF: 80, tilt: 1.2, tiltF: 1000, hf: 1.5, hfF: 12000, hp: 0, hpF: 40
    },
    edm: {
      name: 'EDM', tag: 'EDM', genre: 'DJ / club',
      note: 'deep +6 dB shelf below 60 Hz, gentle top',
      sub: 6, subF: 60, tilt: 0.6, tiltF: 2000, hf: 1, hfF: 14000, hp: 0, hpF: 40
    },
    /* monitors: low end in a wedge only eats gain before feedback, and the
       200-400 Hz region goes boxy from floor coupling and baffle loading. The
       HPF and that cut matter more than any shelf. */
    wedge: {
      name: 'Vocal wedge', tag: 'Wedge', genre: 'Stage monitor · vocal',
      note: 'HPF roll below 120 Hz, 315 Hz cut, 3.15 kHz presence',
      sub: 0, subF: 60, tilt: 1, tiltF: 4000, hf: 1.5, hfF: 12000,
      /* a real monitor HPF is 12 dB/oct or more; 6 dB/oct is the honest middle
         ground for a target you can actually match with output EQ */
      hp: 6, hpF: 120,
      bands: [{ f: 315, db: -2.5, oct: 0.6 }, { f: 3150, db: 1.5, oct: 0.5 }]
    },
    drumfill: {
      name: 'Drum fill', tag: 'Drum fill', genre: 'Stage monitor · drum fill / side fill',
      note: 'fuller low end, 400 Hz cut, gentle top',
      sub: 2.5, subF: 80, tilt: 1, tiltF: 6000, hf: 1.5, hfF: 12000,
      hp: 6, hpF: 45,
      bands: [{ f: 400, db: -2, oct: 0.7 }]
    },
    /* cars reinforce bass and mask detail with road noise, so every published
       car curve carries far more low end than a room one. */
    car: {
      name: 'Car', tag: 'Car', genre: 'Vehicle · daily / SQ',
      note: '+8 dB below 80 Hz, 2 dB shelf above 9 kHz',
      sub: 8, subF: 80, tilt: 0.8, tiltF: 1000, hf: 2, hfF: 9000, hp: 0, hpF: 40
    },
    carSpl: {
      name: 'Car (bass-heavy)', tag: 'Car · deep', genre: 'Vehicle · bass-heavy / SPL',
      note: '+12 dB below 60 Hz, flatter top',
      sub: 12, subF: 60, tilt: 0.5, tiltF: 2000, hf: 1.5, hfF: 12000, hp: 0, hpF: 40
    },
    /* home rooms sit between a living room and a dubbing stage: a modest bass
       shelf, then a gentle top-octave roll for the direct/reflected balance. */
    homeTheatre: {
      name: 'Home theatre', tag: 'Home theatre', genre: 'Home theatre · living room',
      note: '+4 dB below 90 Hz, gentle top-octave roll',
      sub: 4, subF: 90, tilt: 0.8, tiltF: 2000, hf: 1.5, hfF: 10000, hp: 0, hpF: 40
    },
    homeTheatreSmall: {
      name: 'Home theatre (small room)', tag: 'Home · small', genre: 'Home theatre · small room / apartment',
      note: '+2.5 dB below 100 Hz, more HF roll for close reflections',
      sub: 2.5, subF: 100, tilt: 0.8, tiltF: 2000, hf: 2.5, hfF: 8000, hp: 0, hpF: 40
    },
    /* two-seat listening: the Harman in-room preference, and the plain B&K-style
       straight tilt that a neutral system already measures in a real room. */
    stereo: {
      name: 'Stereo room', tag: 'Stereo', genre: 'Stereo listening · Harman in-room',
      note: '+5 dB below 105 Hz, 0.9 dB/oct from 1 kHz',
      sub: 5, subF: 105, tilt: 0.9, tiltF: 1000, hf: 1, hfF: 12000, hp: 0, hpF: 40
    },
    stereoFlat: {
      name: 'Stereo (1 dB/oct)', tag: 'Stereo · tilt', genre: 'Stereo listening · B&K-style tilt',
      note: 'straight 1 dB/oct slope, no shelf',
      sub: 0, subF: 60, tilt: 1, tiltF: 20, hf: 0, hfF: 12000, hp: 0, hpF: 63
    },
    cinema: {
      name: 'Cinema', tag: 'Cinema · large', genre: 'X-curve, large room',
      note: 'ISO 2969 / SMPTE ST 202: flat to 2 kHz, -3 dB/oct above it',
      sub: 0, subF: 60, tilt: 3, tiltF: 2000, hf: 0, hfF: 10000, hp: 3, hpF: 63
    },
    cinemaSmall: {
      name: 'Cinema', tag: 'Cinema · small', genre: 'X-curve, small room',
      note: 'small-room X: flat to 2 kHz, then -1.5 dB/oct',
      sub: 0, subF: 60, tilt: 1.5, tiltF: 2000, hf: 0, hfF: 10000, hp: 3, hpF: 63
    }
  };

  /* Every term below is something a system tech actually adjusts, and the
     top-octave roll is a shelf rather than another endless slope, so a curve
     cannot quietly pile up 8 dB/oct in the last octave. */
  function curveAt(preset, f) {
    const t = TARGETS[preset];
    if (!t) return null;
    let v = 0;
    /* low shelf: full lift below the corner, half at it, gone by 2x */
    if (t.sub) v += t.sub / (1 + Math.pow(f / t.subF, 4));
    /* constant house tilt from its own corner, dB/oct from there up */
    if (t.tilt && f > t.tiltF) v -= t.tilt * Math.log2(f / t.tiltF);
    /* top-octave shelf: saturates at -hf dB instead of sloping forever */
    if (t.hf) v -= t.hf / (1 + Math.pow(t.hfF / f, 4));
    /* do not aim a system below its sub corner */
    if (t.hp && f < t.hpF) v -= t.hp * Math.log2(t.hpF / f);
    /* named broad bands: the low-mid cut and presence lift of a wedge */
    if (t.bands) {
      for (const b of t.bands) {
        const d = Math.log2(f / b.f) / b.oct;
        v += b.db * Math.exp(-0.5 * d * d);
      }
    }
    return v;
  }

  function curveValue(f) {
    if (S.targetPreset === 'custom') {
      if (customCurve && customCurve.freqs && customCurve.levels) {
        return sampleSeries(customCurve.levels, customCurve.freqs, f);
      }
      return null;
    }
    return curveAt(S.targetPreset, f);
  }

  function fmtSigned(v) {
    const r = Math.round(v * 10) / 10;
    return (r > 0 ? '+' : '') + r.toFixed(1);
  }

  function syncCurveNote() {
    const el = $('#curveNote');
    if (!el) return;
    if (S.targetPreset === 'none') {
      el.textContent = 'No target drawn. Pick a genre curve to compare against.';
      return;
    }
    if (S.targetPreset === 'custom') {
      el.textContent = customCurve
        ? 'Your imported curve, ' + customCurve.freqs.length + ' points.'
        : 'Nothing imported yet — use Import curve below.';
      return;
    }
    const t = TARGETS[S.targetPreset];
    if (!t) { el.textContent = ''; return; }
    /* quote the curve's own numbers, so the note cannot drift from the shape */
    const mid = curveAt(S.targetPreset, 1000);
    const lo = curveAt(S.targetPreset, 40) - mid;
    const hi = curveAt(S.targetPreset, 10000) - mid;
    el.textContent = t.genre + ' · ' + t.note +
      ' · 40 Hz ' + fmtSigned(lo) + ' dB, 10 kHz ' + fmtSigned(hi) + ' dB';
  }

  /* Levels are dBFS in the -12..-96 window, so a curve drawn at its nominal
     0 dB would sit above the plot and appear to do nothing. Align it to the
     middle of the live data whenever a curve is chosen. */
  function alignCurve() {
    const d = rtaChan().avg.data;
    let offset = -36;
    if (d && bands.length) {
      const diffs = [];
      for (let i = 0; i < bands.length; i += 3) {
        const c = curveValue(bands[i].fc);
        if (c == null || !isFinite(d[i])) continue;
        diffs.push(d[i] - c);
      }
      if (diffs.length) {
        diffs.sort((a, b) => a - b);
        offset = diffs[diffs.length >> 1];
      }
    }
    S.targetOffset = Math.round(clamp(offset, -60, 20));
  }

  function drawTarget(ctx, g) {
    if (S.targetPreset === 'none') return;
    if (S.targetPreset === 'custom' && !customCurve) return;
    const u0 = toU(view.f0), u1 = toU(view.f1);
    const N = 220;
    /* an unknown preset id (or an import that never landed) would draw a line
       through NaN: bail out rather than scribble on the plot */
    if (curveValue(fromU(u0)) == null) return;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const f = fromU(lerp(u0, u1, i / N));
      const v = curveValue(f);
      const x = g.x + g.w * (i / N);
      const y = db2y(clampDB(v) + S.targetOffset, g);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#e8e8e8';
    ctx.globalAlpha = 0.85;
    ctx.stroke();

    /* name the curve on the plot: on a tablet you should not have to open
       settings to know which target you are mixing against */
    const label = S.targetPreset === 'custom' ? 'Custom' : (TARGETS[S.targetPreset] || {}).tag;
    if (label) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.7;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#c9c9d0';
      ctx.fillText(label, g.x + g.w - 8, g.y + 15);
    }
    ctx.restore();
  }

  /* ---------------- drawing: RTA ---------------- */
  const IN1_COLOR = '#12b312';
  const IN2_COLOR = '#ffb300';

  function drawPrimaryData(ctx, g, data, color, off) {
    if (S.display === 'bars') {
      ctx.fillStyle = color;
      const bottom = g.y + g.h;
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        let x0 = f2x(b.lo, g);
        let x1 = f2x(b.hi, g);
        if (x1 < g.x || x0 > g.x + g.w) continue;
        const y = db2y(clampDB(data[i]) + off, g);
        const full = x1 - x0;
        /* hairline gaps look like a comb at 1/48 oct; tighten them up */
        const w = Math.max(1, full - (full > 4 ? 1 : 0.4));
        ctx.fillRect(x0 + 0.2, y, w, bottom - y);
      }
    } else {
      drawSeries(ctx, g, bandFc, data, color, S.lineThickness, off, 0.24);
    }
  }

  /* marker lines: exact frequency, draggable, with the span shaded between */
  function drawMarkers(ctx, g, map = f2x) {
    const a = numMark(S.markA);
    const b = numMark(S.markB);
    if (a == null && b == null) return;
    const xa = a != null ? map(a, g) : null;
    const xb = b != null ? map(b, g) : null;
    ctx.save();
    if (xa != null && xb != null) {
      const l = Math.max(g.x, Math.min(xa, xb));
      const r = Math.min(g.x + g.w, Math.max(xa, xb));
      if (r > l) {
        ctx.fillStyle = 'rgba(102,194,255,.09)';
        ctx.fillRect(l, g.y, r - l, g.h);
      }
    }
    const rows = [['A', a, xa, '#66c2ff'], ['B', b, xb, '#ffd166']];
    for (const [name, f, x, color] of rows) {
      if (f == null || x == null) continue;
      if (x < g.x - 1 || x > g.x + g.w + 1) continue;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, g.y);
      ctx.lineTo(Math.round(x) + 0.5, g.y + g.h);
      ctx.stroke();
      /* grab handle on the top edge, so the line reads as draggable */
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 7, g.y);
      ctx.lineTo(x + 7, g.y);
      ctx.lineTo(x, g.y + 9);
      ctx.closePath();
      ctx.fill();
      const label = name + ' ' + fmtHzCursor(f);
      ctx.font = '600 10px system-ui,sans-serif';
      const w = ctx.measureText(label).width + 8;
      const lx = clamp(x - w / 2, g.x + 1, g.x + g.w - w - 1);
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = 'rgba(10,10,12,.92)';
      ctx.fillRect(lx, g.y + 9, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 4, g.y + 16.5);
    }
    ctx.restore();
  }

  /* which input each colour belongs to. Bottom-right, where the top octaves
     live and the plot is emptiest, so it never covers a usable bar. */
  function drawChannelLegend(ctx, g) {
    ctx.save();
    ctx.font = '600 10px system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = g.y + g.h - 30;
    for (const [label, color] of [['IN 1', IN1_COLOR], ['IN 2', IN2_COLOR]]) {
      const w = ctx.measureText(label).width + 18;
      const x = g.x + g.w - w - 7;
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = 'rgba(10,10,12,.86)';
      ctx.fillRect(x, y - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillRect(x + 3, y - 2, 8, 4);
      ctx.fillStyle = '#d7d7dc';
      ctx.fillText(label, x + 15, y + 0.5);
      y += 16;
    }
    ctx.restore();
  }

  function drawRTA() {
    const c = rtaCanvas;
    fitCanvas(c);
    const ctx = rtaCtx;
    const W = c.__w, H = c.__h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = pal().bg;
    ctx.fillRect(0, 0, W, H);

    const g = geomRTA(c);
    ctx.fillStyle = pal().plot;
    ctx.fillRect(g.x, g.y, g.w, g.h);

    drawGridLayer(ctx, c, g);

    const off = S.yOffsetEnabled ? S.offset : 0;
    const dual = isDual();
    const primKey = (dual && S.rtaSource === 'b') ? 'b' : 'a';
    const prim = CH[primKey];
    const primColor = dual ? (primKey === 'a' ? IN1_COLOR : IN2_COLOR) : IN1_COLOR;

    /* stored traces behind the live data */
    for (const t of traces) {
      if (!t.visible) continue;
      drawSeries(ctx, g, t.freqs, t.levels, t.color, S.traceThickness, off + (t.offset || 0), 0.28);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.clip();

    /* the newest un-averaged frame, shown only as a display aid */
    if (S.showLiveTrace && prim.avg.data && prim.raw.length === bands.length) {
      drawSeries(ctx, g, bandFc, prim.raw, primColor, 1.5, off, 0, 0.28);
    }

    if (dual) {
      /* the input that is not filling the plot is overlaid as a line, so a
         microphone and a console feed can be read against each other */
      const secKey = primKey === 'a' ? 'b' : 'a';
      const sec = CH[secKey];
      if (sec.avg.data) {
        drawSeries(ctx, g, bandFc, sec.avg.data, secKey === 'a' ? IN1_COLOR : IN2_COLOR, 2, off, 0);
      }
    }
    if (prim.avg.data) drawPrimaryData(ctx, g, prim.avg.data, primColor, off);
    if (prim.hold) drawSeries(ctx, g, bandFc, prim.hold, 'rgba(255,255,255,.85)', 1, off, 0);

    /* the target curve belongs on top of the data, inside the plot */
    drawTarget(ctx, g);
    drawMarkers(ctx, g);

    ctx.restore();

    if (dual) drawChannelLegend(ctx, g);
  }

  function drawSeries(ctx, g, freqs, levels, color, thickness, offsetDb, fillAlpha, strokeAlpha = 1) {
    if (!freqs.length) return;
    ctx.save();
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < freqs.length; i++) {
      const x = f2x(freqs[i], g);
      const y = db2y(clampDB(levels[i]) + offsetDb, g);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    if (fillAlpha > 0) {
      ctx.save();
      ctx.lineTo(f2x(freqs[freqs.length - 1], g), g.y + g.h);
      ctx.lineTo(f2x(freqs[0], g), g.y + g.h);
      ctx.closePath();
      ctx.globalAlpha = fillAlpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
      /* re-trace the top edge for the stroke */
      ctx.beginPath();
      first = true;
      for (let i = 0; i < freqs.length; i++) {
        const x = f2x(freqs[i], g);
        const y = db2y(clampDB(levels[i]) + offsetDb, g);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
    }
    ctx.globalAlpha = strokeAlpha;
    ctx.lineWidth = thickness;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- drawing: spectrograph ---------------- */
  /* The range strip sits along the bottom of the panel, so the plot reserves a
     bottom margin that grows with the panel height (a short panel cannot spare
     the full strip). Rendering and hit-testing share this so the cursor lines up
     with what is actually drawn. */
  function specMargins(H) {
    /* the level strip is pinned to the panel bottom and the frequency labels
       sit just under the plot, so reserve room for both */
    const strip = specCtrlEl ? specCtrlEl.offsetHeight : 0;
    const b = strip ? Math.min(Math.round(H * 0.45), strip + 20) : 18;
    return { l: 34, r: 8, t: 16, b: Math.max(18, b) };
  }

  function geomSpec(c) {
    const W = c.__w || 1, H = c.__h || 1;
    const m = specMargins(H);
    return { x: m.l, y: m.t, w: Math.max(1, W - m.l - m.r), h: Math.max(1, H - m.t - m.b) };
  }

  function drawSpec() {
    const c = specCanvas;
    fitCanvas(c);
    const ctx = specCtx;
    const W = c.__w, H = c.__h;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = pal().spec;
    ctx.fillRect(0, 0, W, H);

    if (!spec.a) return;

    /* Frequency runs left-to-right on the same axis as the RTA below it;
       time runs top-to-bottom, so each new slice enters at the bottom and
       the history scrolls UP. */
    const m = specMargins(H);
    const gx = m.l, gy = m.t;
    const gw = Math.max(1, W - m.l - m.r);
    const gh = Math.max(1, H - m.t - m.b);

    const HW = S.specHistory;
    const BW = spec.w;
    const sx = clamp(BW - HW - rewound, 0, Math.max(0, BW - HW));

    /* Buffer rows are log-spaced frequency, lowest at row 0, so the RTA's
       zoom window is a vertical crop of the image. Both plots then share one
       frequency axis: zoom one and the other follows. */
    const logSpan = Math.log2(FMAX / FMIN);
    const rowA = clamp(Math.log2(view.f0 / FMIN) / logSpan * spec.h, 0, spec.h);
    const rowB = clamp(Math.log2(view.f1 / FMIN) / logSpan * spec.h, 0, spec.h);
    const rowH = Math.max(0.02, rowB - rowA);

    /* the buffer stores time on X and frequency on Y; swap the axes on draw */
    ctx.save();
    ctx.translate(gx, gy);
    ctx.transform(0, 1, 1, 0, 0, 0);
    /* zoomed in, one row is several pixels tall: interpolate rather than show
       the buffer's rows as coloured blocks */
    ctx.imageSmoothingEnabled = !!S.specSmooth || gh / rowH > 2;
    ctx.drawImage(spec.a, sx, rowA, HW, rowH, 0, 0, gh, gw);
    ctx.restore();

    const g = { x: gx, y: gy, w: gw, h: gh };

    /* frequency ruler under the plot, matching the RTA */
    ctx.font = '10px system-ui,-apple-system,Roboto,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let lastRight = -1e9;
    for (const t of logTicks()) {
      if (!t.label) continue;
      const x = Math.round(f2xLog(t.f, g)) + 0.5;
      if (x < gx || x > gx + gw) continue;
      ctx.strokeStyle = pal().specLine;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x, gy + gh);
      ctx.stroke();
      const txt = fmtHz(prefHz(t.f));
      const w = ctx.measureText(txt).width;
      /* same collision rule as the RTA ruler */
      if (x - w / 2 >= lastRight + 6) {
        lastRight = x + w / 2;
        ctx.fillStyle = pal().label;
        ctx.fillText(txt, x, gy + gh + 3);
      }
    }

    /* time ruler down the left edge: oldest at the top, now at the bottom */
    const backSec = rewound * spec.dt;
    const spanSec = HW * spec.dt;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const p = i / 4;
      const ago = spanSec * (1 - p) + backSec;
      const y = gy + gh * p;
      const label = ago < 0.6 ? 'now' : '-' + (ago >= 10 ? Math.round(ago) : ago.toFixed(1)) + 's';
      ctx.fillStyle = pal().label;
      ctx.fillText(label, gx - 5, clamp(y, gy + 6, gy + gh - 6));
    }

    /* the same A/B lines as the RTA, on the waterfall's own log axis, and
       draggable from either plot */
    drawMarkers(ctx, g, f2xLog);

    ctx.strokeStyle = pal().specFrame;
    ctx.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1);
  }

  /* ---------------- cursor ---------------- */
  let cursorOn = false;

  /* One row per input in 1+2, a single row otherwise. Trim is already in the
     averaged data, so only the display offset is added here. */
  function channelRows(f, off) {
    let html = '';
    if (isDual()) {
      for (const k of ['a', 'b']) {
        const d = CH[k].avg.data;
        if (!d) continue;
        html += '<div><span class="ck" style="color:' + (k === 'a' ? IN1_COLOR : IN2_COLOR) +
          '">IN ' + (k === 'a' ? '1' : '2') + '</span>' + fmtDb(sampleBands(d, f) + off) + '</div>';
      }
    } else {
      const d = rtaChan().avg.data;
      if (d) html += '<div><span class="ck">Live</span>' + fmtDb(sampleBands(d, f) + off) + '</div>';
    }
    return html;
  }

  function updateCursor(x) {
    const c = rtaCanvas;
    const g = geomRTA(c);
    if (x < g.x || x > g.x + g.w) { hideCursor(); return; }
    const f = x2f(x, g);
    const off = S.yOffsetEnabled ? S.offset : 0;
    let html = '<div class="cursorBox"><div><span class="ck">Hz</span>' + fmtHzCursor(f) + '</div>';
    html += channelRows(f, off);
    for (const t of traces) {
      if (!t.visible) continue;
      const v = sampleSeries(t.levels, t.freqs, f) + off + (t.offset || 0);
      html += '<div><span class="ck" style="color:' + t.color + '">' + esc(t.name) + '</span>' + fmtDb(v) + '</div>';
    }
    html += '</div>';
    cursorEl.innerHTML = html;
    cursorEl.classList.remove('hidden');
    cursorEl.style.left = Math.round(x) + 'px';
    cursorEl.classList.toggle('flip', x > g.x + g.w * 0.62);
    cursorOn = true;
  }

  function hideCursor() {
    cursorEl.classList.add('hidden');
    cursorOn = false;
  }

  /* ---- spectrograph cursor: the same readout the RTA gives you, with the
     level at the row under your finger and how far back that row is ---- */
  let lastSpecPt = null;

  function specAgo(y, g) {
    const spanSec = S.specHistory * spec.dt;
    const p = clamp((y - g.y) / g.h, 0, 1);
    return spanSec * (1 - p) + rewound * spec.dt;
  }

  function updateSpecCursor(x, y) {
    const g = geomSpec(specCanvas);
    if (x < g.x - 1 || x > g.x + g.w + 1 || y < g.y - 1 || y > g.y + g.h + 1) { hideSpecCursor(); return; }
    lastSpecPt = { x: x, y: y };
    const f = x2fLog(x, g);
    const off = S.yOffsetEnabled ? S.offset : 0;
    const ago = specAgo(y, g);
    const lvl = specLevelAt(x, y, g);
    let html = '<div class="cursorBox"><div><span class="ck">Hz</span>' + fmtHzCursor(f) + '</div>';
    html += '<div><span class="ck">Lvl</span>' + (lvl == null ? '—' : fmtDb(lvl + off)) + '</div>';
    for (const k of ['a', 'b']) {
      const mf = numMark(k === 'a' ? S.markA : S.markB);
      if (mf == null) continue;
      const ml = specLevelAt(f2xLog(mf, g), y, g);
      html += '<div><span class="ck" style="color:' + (k === 'a' ? '#66c2ff' : '#ffd166') + '">' +
        k.toUpperCase() + ' ' + fmtHzCursor(mf) + '</span>' +
        (ml == null ? '—' : fmtDb(ml + off)) + '</div>';
    }
    html += '<div><span class="ck">T</span>' +
      (ago < 0.6 ? 'now' : '-' + (ago >= 10 ? Math.round(ago) : ago.toFixed(1)) + 's') + '</div></div>';
    specCursorEl.innerHTML = html;
    const box = specCursorEl.firstChild;
    if (box) box.style.top = Math.round(clamp(y - 10, 12, g.y + g.h - 64)) + 'px';
    specCursorEl.classList.remove('hidden');
    specCursorEl.style.left = Math.round(x) + 'px';
    specCursorEl.classList.toggle('flip', x > g.x + g.w * 0.62);
  }

  function hideSpecCursor() {
    specCursorEl.classList.add('hidden');
    lastSpecPt = null;
  }

  /* ---------------- interaction ---------------- */
  const pointers = new Map();
  let pinch = null;
  let markDrag = null;
  let tapStart = null;

  function localPt(e) {
    const r = rtaCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function markerAt(x, g, map = f2x) {
    let best = null, bestD = 16;
    for (const k of ['a', 'b']) {
      const f = numMark(k === 'a' ? S.markA : S.markB);
      if (f == null) continue;
      const d = Math.abs(map(f, g) - x);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  function setMark(k, f, persist) {
    const v = clamp(f, FMIN, FMAX);
    if (k === 'b') S.markB = v; else S.markA = v;
    updateMarkBar();
    if (persist) saveSettings();
  }

  /* A tap puts the first free marker on the frequency you touched. With both
     already placed it grabs whichever line is nearer, so repeat taps stay
     predictable instead of silently moving the other one. */
  function placeMarker(f) {
    if (numMark(S.markA) == null) { setMark('a', f, true); return; }
    if (numMark(S.markB) == null) { setMark('b', f, true); return; }
    const g = geomRTA(rtaCanvas);
    const x = f2x(clamp(f, FMIN, FMAX), g);
    const da = Math.abs(f2x(S.markA, g) - x);
    const db = Math.abs(f2x(S.markB, g) - x);
    setMark(da <= db ? 'a' : 'b', f, true);
  }

  function updateMarkBar() {
    const a = numMark(S.markA);
    const b = numMark(S.markB);
    const ea = $('#markA'), eb = $('#markB'), ed = $('#markDelta'), ez = $('#markZoom');
    if (ea) {
      ea.textContent = 'A ' + (a == null ? '—' : fmtHzCursor(a) + ' Hz');
      ea.classList.toggle('unset', a == null);
    }
    if (eb) {
      eb.textContent = 'B ' + (b == null ? '—' : fmtHzCursor(b) + ' Hz');
      eb.classList.toggle('unset', b == null);
    }
    if (ed) {
      if (a != null && b != null) {
        const oct = Math.abs(Math.log2(b / a));
        ed.textContent = oct.toFixed(2) + ' oct · ' + (oct * 12).toFixed(1) + ' st';
      } else {
        ed.textContent = a == null ? 'tap the plot to set A' : 'tap again for B';
      }
    }
    if (ez) ez.disabled = !(a != null && b != null);
  }

  function zoomToMarkers() {
    const a = numMark(S.markA), b = numMark(S.markB);
    if (a == null || b == null) { toast('Set both markers first'); return; }
    setViewU(toU(Math.min(a, b)), toU(Math.max(a, b)));
    toast('Zoomed to ' + fmtHzCursor(Math.min(a, b)) + '–' + fmtHzCursor(Math.max(a, b)) + ' Hz');
  }

  function clearMarkers() {
    S.markA = null;
    S.markB = null;
    saveSettings();
    updateMarkBar();
  }

  rtaCanvas.addEventListener('pointerdown', (e) => {
    /* capture can throw for an already-released pointer id; a lost capture
       must never take the whole handler (and the readout) down with it */
    try { rtaCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    const p = localPt(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      pinch = {
        d: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        u0: toU(view.f0),
        u1: toU(view.f1)
      };
      markDrag = null;
      tapStart = null;
      hideCursor();
    } else if (pointers.size === 1) {
      const g = geomRTA(rtaCanvas);
      const hit = markerAt(p.x, g);
      if (hit) {
        /* grab a marker line and drag it: frequency follows the finger exactly */
        markDrag = hit;
        setMark(hit, x2f(clamp(p.x, g.x, g.x + g.w), g), false);
      } else {
        tapStart = { x: p.x, y: p.y, moved: 0 };
      }
      updateCursor(p.x);
    }
  });

  rtaCanvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = localPt(e);
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2 && pinch) {
      const pts = Array.from(pointers.values());
      const g = geomRTA(rtaCanvas);
      const d = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const cx = (pts[0].x + pts[1].x) / 2;
      const centerU = pinch.u0 + (cx - g.x) / g.w * (pinch.u1 - pinch.u0);
      const span = (pinch.u1 - pinch.u0) * (pinch.d / d);
      setViewU(centerU - span / 2, centerU + span / 2);
    } else if (markDrag) {
      const g = geomRTA(rtaCanvas);
      setMark(markDrag, x2f(clamp(p.x, g.x, g.x + g.w), g), false);
      updateCursor(p.x);
    } else if (pointers.size === 1) {
      if (tapStart) {
        tapStart.moved = Math.max(tapStart.moved, Math.hypot(p.x - tapStart.x, p.y - tapStart.y));
      }
      updateCursor(p.x);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const last = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (markDrag) {
      markDrag = null;
      saveSettings();
    } else if (tapStart && e.type === 'pointerup' && tapStart.moved < 8 && last) {
      const g = geomRTA(rtaCanvas);
      placeMarker(x2f(clamp(last.x, g.x, g.x + g.w), g));
    }
    tapStart = null;
    if (pointers.size === 0) hideCursor();
  }
  rtaCanvas.addEventListener('pointerup', endPointer);
  rtaCanvas.addEventListener('pointercancel', endPointer);

  rtaPanel.addEventListener('wheel', (e) => {
    e.preventDefault();
    const c = rtaCanvas;
    const g = geomRTA(c);
    const p = localPt(e);
    const u0 = toU(view.f0), u1 = toU(view.f1);
    const centerU = u0 + (p.x - g.x) / g.w * (u1 - u0);
    const span = (u1 - u0) * (e.deltaY > 0 ? 1.18 : 0.85);
    setViewU(centerU - span / 2, centerU + span / 2);
  }, { passive: false });

  /* ---- spectrograph interaction ----
     Horizontal drag gives the frequency readout; a vertical drag (or the wheel)
     scrolls back through the history, which also drives the rewind slider. */
  const specPointers = new Map();
  let specPinch = null;
  let specDrag = null;

  function specPt(e) {
    const r = specCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setRewound(n) {
    const max = Math.max(1, S.specHistory - 1);
    rewound = clamp(Math.round(n), 0, max);
    rewInput.max = String(max);
    rewInput.value = String(rewound);
    const sec = rewound * spec.dt;
    rewLabel.textContent = rewound === 0 ? 'now' : '-' + (sec >= 10 ? sec.toFixed(0) : sec.toFixed(1)) + 's';
    rewWrap.classList.toggle('hidden', !S.paused && rewound === 0);
    if (lastSpecPt) updateSpecCursor(lastSpecPt.x, lastSpecPt.y);
  }

  specCanvas.addEventListener('pointerdown', (e) => {
    try { specCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    const p = specPt(e);
    specPointers.set(e.pointerId, p);
    if (specPointers.size === 2) {
      const pts = Array.from(specPointers.values());
      specPinch = {
        d: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        u0: toU(view.f0), u1: toU(view.f1)
      };
      specDrag = null;
      hideSpecCursor();
    } else if (specPointers.size === 1) {
      const g = geomSpec(specCanvas);
      const hit = markerAt(p.x, g, f2xLog);
      if (hit) {
        specDrag = { mode: 'mark', k: hit, x0: p.x, y0: p.y, rew0: rewound };
        setMark(hit, x2fLog(clamp(p.x, g.x, g.x + g.w), g), false);
      } else {
        specDrag = { mode: 'free', x0: p.x, y0: p.y, rew0: rewound };
      }
      updateSpecCursor(p.x, p.y);
    }
  });

  specCanvas.addEventListener('pointermove', (e) => {
    if (!specPointers.has(e.pointerId)) return;
    const p = specPt(e);
    specPointers.set(e.pointerId, p);
    if (specPointers.size >= 2 && specPinch) {
      const pts = Array.from(specPointers.values());
      const g = geomSpec(specCanvas);
      const d = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const cx = (pts[0].x + pts[1].x) / 2;
      const centerU = specPinch.u0 + (cx - g.x) / g.w * (specPinch.u1 - specPinch.u0);
      const span = (specPinch.u1 - specPinch.u0) * (specPinch.d / d);
      setViewU(centerU - span / 2, centerU + span / 2);
      return;
    }
    if (!specDrag) return;
    if (specDrag.mode === 'mark') {
      const gm = geomSpec(specCanvas);
      setMark(specDrag.k, x2fLog(clamp(p.x, gm.x, gm.x + gm.w), gm), false);
      hideSpecCursor();
      return;
    }
    const dx = p.x - specDrag.x0;
    const dy = p.y - specDrag.y0;
    if (specDrag.mode === 'free') {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) specDrag.mode = 'scrub';
      else if (Math.abs(dx) > 8) specDrag.mode = 'freq';
    }
    if (specDrag.mode === 'scrub') {
      const g = geomSpec(specCanvas);
      const perSlice = Math.max(6, g.h / 36);
      setRewound(specDrag.rew0 + Math.round(dy / perSlice));
      hideSpecCursor();
    } else {
      updateSpecCursor(p.x, p.y);
    }
  });

  function endSpecPointer(e) {
    if (!specPointers.has(e.pointerId)) return;
    specPointers.delete(e.pointerId);
    if (specPointers.size < 2) specPinch = null;
    if (specPointers.size === 0) {
      if (specDrag && specDrag.mode === 'mark') saveSettings();
      specDrag = null;
      hideSpecCursor();
    }
  }
  specCanvas.addEventListener('pointerup', endSpecPointer);
  specCanvas.addEventListener('pointercancel', endSpecPointer);

  specPanel.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    setRewound(rewound + Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 30)));
  }, { passive: false });

  function zoomBy(factor) {
    const u0 = toU(view.f0), u1 = toU(view.f1);
    const c = (u0 + u1) / 2;
    const span = (u1 - u0) * factor;
    setViewU(c - span / 2, c + span / 2);
  }

  /* splitter */
  const splitter = $('#splitter');
  const plotsEl = $('#plots');
  let splitFrac = typeof S.split === 'number' ? clamp(S.split, 0.12, 0.88) : 0.42;

  /* The split is remembered as a fraction and applied as a percentage, so it
     reflows with the container instead of going stale when the viewport or the
     top bar changes height. The clamp keeps a usable RTA pane (never squeezed
     to nothing, which is how the bottom of it used to end up off screen) while
     leaving the spectrograph some room on a short viewport. */
  function applySplit() {
    if (focusMode !== 'both') return;
    const reserve = (splitter.offsetHeight || 12) + 120;
    specPanel.style.flexBasis =
      'clamp(48px, ' + (splitFrac * 100).toFixed(2) + '%, calc(100% - ' + reserve + 'px))';
    gridCache.key = '';
  }

  splitter.addEventListener('pointerdown', (e) => {
    try { splitter.setPointerCapture(e.pointerId); } catch (err) {}
    const move = (ev) => {
      const host = plotsEl.getBoundingClientRect();
      const frac = host.height > 0 ? (ev.clientY - host.top) / host.height : splitFrac;
      splitFrac = clamp(frac, 0.12, 0.88);
      applySplit();
    };
    const up = () => {
      S.split = +splitFrac.toFixed(3);
      saveSettings();
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });

  /* ---------------- focus / full screen views ---------------- */
  let focusMode = 'both';

  function setFocus(mode) {
    focusMode = mode;
    specPanel.classList.toggle('hidden', mode === 'rta');
    rtaPanel.classList.toggle('hidden', mode === 'spec');
    splitter.classList.toggle('hidden', mode !== 'both');
    specPanel.style.flexGrow = mode === 'spec' ? '1' : '0';
    specPanel.style.flexShrink = mode === 'spec' ? '1' : '0';
    if (mode === 'both') {
      rtaPanel.style.flex = '1 1 auto';
      applySplit();
    } else if (mode === 'spec') {
      specPanel.style.flexBasis = 'auto';   /* full-screen spectrograph fills the pane */
    }
    $('#railSpec').classList.toggle('on', mode === 'spec');
    $('#railRta').classList.toggle('on', mode === 'rta');
    gridCache.key = '';
  }

  $('#railSpec').addEventListener('click', () => setFocus(focusMode === 'spec' ? 'both' : 'spec'));
  $('#railRta').addEventListener('click', () => setFocus(focusMode === 'rta' ? 'both' : 'rta'));

  /* ---------------- visible viewport ---------------- */
  /* A fixed full-screen instrument has to fit the *visible* area. Mobile browsers
     keep a layout viewport taller than the screen while their toolbars are shown
     (classically in landscape), so `inset:0` ran past the bottom edge and the RTA
     was clipped with nothing to scroll. Track the visual viewport and pin the
     shell to it; recompute after toolbars retract or the device rotates. */
  let appH = 0;
  function syncAppHeight() {
    const vv = window.visualViewport;
    if (vv && vv.scale > 1.02) return;   /* pinch-zoomed: keep the layout stable */
    const h = Math.round(vv ? vv.height : window.innerHeight);
    if (!h || h === appH) return;
    appH = h;
    document.documentElement.style.setProperty('--appH', h + 'px');
  }
  let vpQueued = 0;
  function queueViewportSync() {
    if (vpQueued) return;
    vpQueued = requestAnimationFrame(() => {
      vpQueued = 0;
      syncAppHeight();
      applySplit();
    });
  }
  syncAppHeight();
  applySplit();
  window.addEventListener('resize', queueViewportSync);
  window.addEventListener('orientationchange', () => setTimeout(queueViewportSync, 280));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueViewportSync);
    window.visualViewport.addEventListener('scroll', queueViewportSync);
  }

  /* ---------------- settings plumbing ---------------- */
  function syncValues() {
    $$('[data-setting]').forEach((el) => {
      const k = el.dataset.setting;
      if (!(k in S)) return;
      /* Basic averaging shows a category; Advanced shows the exact value. */
      const v = k === 'averaging' && el.dataset.avgView === 'basic'
        ? basicAveraging()
        : S[k];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el) el.value = String(v);
      else if (el.tagName === 'SELECT') el.value = String(v);
    });
    $$('.rowVal').forEach((sp) => {
      const k = sp.dataset.for;
      if (k in S) sp.textContent = String(S[k]);
    });
    const rv = $('#railTrimVal');
    if (rv) {
      const t = activeTrim();
      rv.textContent = (t > 0 ? '+' : '') + t;
      rv.classList.toggle('zero', t === 0);
    }
    const rl = $('#railTrimLbl');
    if (rl) rl.textContent = 'Trim';
    syncTrimUI();
    syncInputSource();
    syncMicCalibration();
    updateMarkBar();
    syncCurveNote();
    syncSeg('display', S.display);
    syncSeg('specSmooth', String(S.specSmooth));
    syncSeg('chan', S.chanMode);
    syncSeg('theme', S.theme);
    syncSeg('uiMode', S.uiMode);
    syncSeg('eqSmooth', S.eqSmooth);
    syncSeg('eqFormat', S.eqFormat);
    syncCustomAvg();
    applyUiTip();
  }

  function syncCustomAvg() {
    const box = $('#customAvgBox');
    if (!box) return;
    box.classList.toggle('hidden', effectiveAveraging() !== 'custom');
    box.dataset.mode = S.customAvgType === 'flat' ? 'flat' : 'split';
  }

  function syncSeg(name, value) {
    $$('.seg[data-seg="' + name + '"]').forEach((seg) => {
      $$('.segBtn', seg).forEach((b) => b.classList.toggle('active', b.dataset.value === value));
    });
  }

  /* Easy keeps only the controls a live user reaches for; Advanced reveals the
     technical layer without duplicating anything. The attribute lives on the
     root so the whole sheet responds without re-rendering the controls. */
  function applyUiMode() {
    const easy = S.uiMode !== 'advanced';
    document.documentElement.dataset.ui = easy ? 'easy' : 'advanced';
    if (!easy) return;
    const active = $('.seg[data-seg="tab"] .segBtn.active');
    if (active && active.dataset.tab === 'spec') {
      const display = $('.seg[data-seg="tab"] .segBtn[data-tab="top"]');
      if (display) display.click();
    }
  }

  /* One short hint, once. It lives next to the switch so it needs no tour,
     and choosing a mode counts as having found it. */
  function applyUiTip() {
    const tip = $('#uiTip');
    if (tip) tip.classList.toggle('hidden', !!S.uiTipSeen);
  }
  function dismissUiTip() {
    if (S.uiTipSeen) return;
    S.uiTipSeen = true;
    applyUiTip();
    saveSettings();
  }

  function applyEffect(k) {
    switch (k) {
      case 'banding': rebuildBands(); break;
      case 'fft':
        forEachAnalyser((an) => { an.fftSize = S.fft; });
        if (audio.a1) CH.a.freq = new Float32Array(audio.a1.frequencyBinCount);
        if (audio.a2) CH.b.freq = new Float32Array(audio.a2.frequencyBinCount);
        mapBands();
        resetAvg();
        break;
      case 'scale': resetView(); break;
      case 'specHistory':
        specReset();
        rewound = 0;
        rewInput.max = String(Math.max(1, S.specHistory - 1));
        break;
      case 'averaging':
      case 'customAvgType':
      case 'customLowMs':
      case 'customHighMs':
      case 'customAllMs':
        if (k === 'averaging' || effectiveAveraging() === 'custom') {
          refreshAvgTau();
          resetAvg();
        }
        break;
      case 'peakHold': CH.a.hold = null; CH.b.hold = null; break;
      case 'trim':
      case 'trimB':
      case 'rtaSource':
      case 'specSource':
        resetAvg();
        break;
      case 'chanMode':
        applyStoredTrim();
        resetAvg();
        break;
      case 'targetPreset':
        if (S.targetPreset !== 'none') alignCurve();
        break;
      case 'theme': applyTheme(); break;
      case 'uiMode': applyUiMode(); break;
      default: break;
    }
    gridCache.key = '';
    updateInfo();
  }

  function setSetting(k, v) {
    /* keep the spectrograph window at least 6 dB wide, whichever end is dragged */
    if (k === 'specMin') v = Math.min(v, S.specMax - 6);
    else if (k === 'specMax') v = Math.max(v, S.specMin + 6);
    if (CUSTOM_MS_KEYS.indexOf(k) >= 0) v = normalizeCustomMs(v, S[k]);
    S[k] = v;
    if (k === 'trim' || k === 'trimB') {
      setStoredTrim(S.micId || 'default', trimTargetForSlot(k === 'trimB' ? 'b' : 'a'), v);
    }
    applyEffect(k);
    syncValues();
    saveSettings();
  }

  function bindSettings() {
    $$('[data-setting]').forEach((el) => {
      const customMs = el.type === 'number' && CUSTOM_MS_KEYS.indexOf(el.dataset.setting) >= 0;
      const ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || customMs) ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const k = el.dataset.setting;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number' && el.value.trim() === '') return;
        else if (el.dataset.type === 'number') v = Number(el.value);
        else v = el.value;
        setSetting(k, v);
      });
      if (customMs) {
        el.addEventListener('blur', () => { el.value = String(S[el.dataset.setting]); });
      }
    });

    $$('.seg[data-seg]').forEach((seg) => {
      const name = seg.dataset.seg;
      if (name === 'tab') return;
      $$('.segBtn', seg).forEach((b) => {
        b.addEventListener('click', () => {
          if (name === 'display') setSetting('display', b.dataset.value);
          else if (name === 'specSmooth') setSetting('specSmooth', Number(b.dataset.value));
          else if (name === 'theme') setSetting('theme', b.dataset.value);
          else if (name === 'uiMode') {
            setSetting('uiMode', b.dataset.value);
            dismissUiTip();
          }
          else if (name === 'eqSmooth') setSetting('eqSmooth', b.dataset.value);
          else if (name === 'eqFormat') setSetting('eqFormat', b.dataset.value);
          else if (name === 'chan') {
            setSetting('chanMode', b.dataset.value);
            if (running && !demoOn) restartInput();
          }
        });
      });
    });

    /* settings tabs */
    $$('.seg[data-seg="tab"] .segBtn').forEach((b) => {
      b.addEventListener('click', () => {
        $$('.seg[data-seg="tab"] .segBtn').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
        $$('.sheetBody .tab').forEach((t) => t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab));
      });
    });
  }

  const infoCache = { a: '', b: '' };

  function updateInfo() {
    if (rtaInfo) {
      const bandTxt = S.banding === 1 ? '1 Oct' : '1/' + S.banding + ' Oct';
      const sr = audio.ctx ? audio.ctx.sampleRate : 0;
      const bin = sr ? ' · Δf ' + (sr / S.fft).toFixed(1) + ' Hz' : '';
      const txt = S.uiMode === 'easy' ? bandTxt
        : bandTxt + (sr ? ' · ' + (sr / 1000).toFixed(1) + ' kHz' : '') + ' · FFT ' + S.fft + bin;
      if (txt !== infoCache.a) { rtaInfo.textContent = txt; infoCache.a = txt; }
    }
    if (specInfo) {
      const txt = (S.specHistory * spec.dt).toFixed(0) + ' s history';
      if (txt !== infoCache.b) { specInfo.textContent = txt; infoCache.b = txt; }
    }
  }

  /* ---------------- sheets ---------------- */
  const scrim = $('#scrim');
  const sheet = $('#sheet');
  const tracesEl = $('#traces');

  function openSheet(el) {
    closeSheets();
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    scrim.classList.remove('hidden');
  }
  function closeSheets() {
    [sheet, tracesEl].forEach((el) => {
      el.classList.remove('open');
      el.setAttribute('aria-hidden', 'true');
    });
    scrim.classList.add('hidden');
  }

  const uiTipClose = $('#uiTipClose');
  if (uiTipClose) uiTipClose.addEventListener('click', dismissUiTip);

  $('#btnSettings').addEventListener('click', () => openSheet(sheet));
  $('#sheetClose').addEventListener('click', closeSheets);
  $('#btnTraces').addEventListener('click', () => { renderTraces(); openSheet(tracesEl); });
  $('#tracesClose').addEventListener('click', closeSheets);
  scrim.addEventListener('click', closeSheets);

  /* Below 520 px the secondary actions move into one overflow menu so the
     action strip stays on a single row. The primary Capture and Auto Trim
     controls remain visible. */
  const moreBtn = $('#btnMore');
  const moreMenu = $('#moreMenu');
  function closeMore() {
    if (!moreMenu || !moreBtn) return;
    moreMenu.classList.add('hidden');
    moreMenu.setAttribute('aria-hidden', 'true');
    moreBtn.setAttribute('aria-expanded', 'false');
    if (moreMenu.contains(document.activeElement)) moreBtn.focus();
  }
  function setMoreOpen(on) {
    if (!moreMenu || !moreBtn) return;
    const open = !!on && innerWidth <= 520;
    moreMenu.classList.toggle('hidden', !open);
    moreMenu.setAttribute('aria-hidden', String(!open));
    moreBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      const first = moreMenu.querySelector('.moreItem');
      if (first) setTimeout(() => first.focus(), 0);
    }
  }
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', () => setMoreOpen(moreMenu.classList.contains('hidden')));
    document.addEventListener('click', (e) => {
      if (moreMenu.classList.contains('hidden')) return;
      if (moreBtn.contains(e.target) || moreMenu.contains(e.target)) return;
      closeMore();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !moreMenu.classList.contains('hidden')) {
        e.preventDefault();
        closeMore();
        moreBtn.focus();
      }
    });
    window.addEventListener('resize', () => { if (innerWidth > 520) closeMore(); });
  }
  const stableMoreBtn = $('#btnCaptureStableMore');
  if (stableMoreBtn) stableMoreBtn.addEventListener('click', () => {
    closeMore();
    toggleStableCapture();
  });
  const tracesMoreBtn = $('#btnTracesMore');
  if (tracesMoreBtn) tracesMoreBtn.addEventListener('click', () => {
    closeMore();
    renderTraces();
    openSheet(tracesEl);
  });
  const settingsMoreBtn = $('#btnSettingsMore');
  if (settingsMoreBtn) settingsMoreBtn.addEventListener('click', () => {
    closeMore();
    openSheet(sheet);
  });

  /* ---------------- capture / traces buttons ---------------- */
  $$('#btnCapture2, #btnCaptureMain').forEach((b) =>
    b.addEventListener('click', () => captureTrace(false)));
  $$('#btnCaptureStable, #btnCaptureStableMain').forEach((b) =>
    b.addEventListener('click', toggleStableCapture));
  const capAvgBtn = $('#btnCaptureAvg');
  if (capAvgBtn) capAvgBtn.addEventListener('click', captureAverage);
  const avgSecsSel = $('#avgSecs');
  if (avgSecsSel) avgSecsSel.addEventListener('change', () => {
    try { localStorage.setItem('rtapro.avgsecs.v1', avgSecsSel.value); } catch (e) {}
  });
  const saveSetupBtn = $('#btnSaveSetup');
  if (saveSetupBtn) saveSetupBtn.addEventListener('click', saveSetup);
  $('#btnAverage').addEventListener('click', averageSelected);
  $('#btnDelete').addEventListener('click', deleteSelected);

  /* ---------------- export / import ---------------- */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  $('#btnExportJson').addEventListener('click', () => {
    if (!traces.length) { toast('No traces to export'); return; }
    const payload = {
      app: 'rta-daddy',
      version: 1,
      exported: new Date().toISOString(),
      sampleRate: audio.ctx ? audio.ctx.sampleRate : null,
      fftSize: S.fft,
      banding: S.banding,
      averaging: S.averaging,
      traces: traces.map((t) => ({
        name: t.name, color: t.color, offset: t.offset, visible: t.visible,
        averaging: t.averaging || null,
        freqs: t.freqs, levels: t.levels
      }))
    };
    download('rta-traces-' + stamp() + '.json', JSON.stringify(payload, null, 1), 'application/json');
    toast('Exported ' + traces.length + ' trace(s)');
  });

  $('#btnExportCsv').addEventListener('click', () => {
    if (!traces.length) { toast('No traces to export'); return; }
    const fc = bands.map((b) => +b.fc.toFixed(3));
    const head = ['freq_hz'].concat(traces.map((t) => '"' + t.name.replace(/"/g, '""') + '"'));
    const lines = ['# RTA Daddy trace export', '# ' + new Date().toISOString(), head.join(',')];
    for (let i = 0; i < fc.length; i++) {
      const row = [fc[i]];
      for (const t of traces) row.push(sampleSeries(t.levels, t.freqs, fc[i]).toFixed(2));
      lines.push(row.join(','));
    }
    download('rta-traces-' + stamp() + '.csv', lines.join('\n'), 'text/csv');
    toast('Exported CSV');
  });

  /* 31-band graphic EQ export: one gain per ISO third-octave centre, so the
     file drops straight into a GEQ or a processor's import field. With a target
     curve shown the gains are the correction towards it; without one they are
     the correction towards the 500 Hz - 2 kHz average, which leaves the overall
     house curve alone. */
  /* Smoothing for the EQ export: energy-average the neighbouring slices of the
     third-octave band, so one narrow resonance cannot set a whole filter. */
  function eqSample(avg, f) {
    if (S.eqSmooth === 'none') return sampleBands(avg, f);
    const half = (S.eqSmooth === 'sixth' ? 1 / 12 : 1 / 6) / 2;
    let sum = 0;
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const d = sampleBands(avg, clamp(f * Math.pow(2, k * half * 2), FMIN, FMAX));
      sum += Math.pow(10, d / 10);
    }
    return 10 * Math.log10(Math.max(sum / 5, 1e-12));
  }

  function eqGains() {
    const ch = rtaChan();
    if (!ch.avg.data) return null;
    const off = S.yOffsetEnabled ? S.offset : 0;
    const hasTarget = S.targetPreset !== 'none' && (S.targetPreset !== 'custom' || customCurve);
    let mode = S.eqRef;
    if (mode === 'auto') mode = hasTarget ? 'target' : 'mid';
    if (mode === 'target' && !hasTarget) mode = 'mid';
    let ref = 0;
    if (mode === 'mid') {
      let sum = 0, n = 0;
      for (let i = 0; i < bands.length; i++) {
        const f = bands[i].fc;
        if (f >= 500 && f <= 2000) { sum += ch.avg.data[i]; n++; }
      }
      ref = n ? sum / n : 0;
    }
    return PREF.map((f) => {
      const meas = eqSample(ch.avg.data, f) + off;
      const want = mode === 'target' ? curveValue(f) + S.targetOffset
        : mode === 'flat' ? 0 : ref;
      return Math.round(clamp(want - meas, -12, 12) * 2) / 2;
    });
  }

  $('#btnExportEq').addEventListener('click', () => {
    const gains = eqGains();
    if (!gains) { toast('Start a measurement first'); return; }
    const withBand = S.eqFormat === 'bfg';
    const lines = [withBand ? 'Band,Freq,Gain' : 'Freq,Gain'];
    for (let i = 0; i < PREF.length; i++) {
      const g = gains[i];
      const val = Number.isInteger(g) ? String(g) : g.toFixed(1);
      lines.push(withBand ? (i + 1) + ',' + PREF[i] + ',' + val : PREF[i] + ',' + val);
    }
    download('rta-geq31-' + stamp() + '.csv', lines.join('\n') + '\n', 'text/csv');
    toast('31-band EQ exported · ±12 dB');
  });

  let importMode = 'traces';
  $('#btnImportTraces').addEventListener('click', () => { importMode = 'traces'; $('#fileInput').click(); });
  $('#btnImportCurve').addEventListener('click', () => { importMode = 'curve'; $('#fileInput').click(); });

  $('#fileInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      if (importMode === 'curve') importCurve(text); else importTraces(text);
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  });

  function importCurve(text) {
    let freqs = [], levels = [];
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const d = JSON.parse(trimmed);
      freqs = d.freqs || (d.points || []).map((p) => p[0]);
      levels = d.levels || (d.points || []).map((p) => p[1]);
    } else {
      for (const line of trimmed.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const parts = line.split(/[,;\t]/).map((s) => parseFloat(s));
        if (parts.length < 2 || !isFinite(parts[0]) || !isFinite(parts[1])) continue;
        freqs.push(parts[0]); levels.push(parts[1]);
      }
    }
    if (!freqs.length || freqs.length !== levels.length) throw new Error('no freq,level rows found');
    const order = freqs.map((f, i) => i).sort((a, b) => freqs[a] - freqs[b]);
    customCurve = { freqs: order.map((i) => freqs[i]), levels: order.map((i) => levels[i]) };
    try { localStorage.setItem('rtapro.curve.v1', JSON.stringify(customCurve)); } catch (e) {}
    setSetting('targetPreset', 'custom');
    toast('Curve imported (' + freqs.length + ' points)');
  }

  function importTraces(text) {
    let incoming = [];
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      const d = JSON.parse(trimmed);
      incoming = d.traces || [];
    } else if (trimmed.startsWith('[')) {
      incoming = JSON.parse(trimmed);
    } else {
      const rows = trimmed.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
      if (rows.length < 2) throw new Error('empty CSV');
      const head = rows[0].split(',').map((s) => s.replace(/^"|"$/g, ''));
      for (let ci = 1; ci < head.length; ci++) {
        const freqs = [], levels = [];
        for (let ri = 1; ri < rows.length; ri++) {
          const cells = rows[ri].split(',');
          const f = parseFloat(cells[0]);
          const v = parseFloat(cells[ci]);
          if (isFinite(f) && isFinite(v)) { freqs.push(f); levels.push(v); }
        }
        if (freqs.length) incoming.push({ name: head[ci] || 'Imported', freqs, levels });
      }
    }
    if (!incoming.length) throw new Error('no traces found');
    for (const t of incoming) {
      traces.push({
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: t.name || 'Imported ' + (++captureCount),
        color: t.color && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : TRACE_COLORS[traces.length % TRACE_COLORS.length],
        offset: Number(t.offset) || 0,
        visible: t.visible !== false,
        averaging: t.averaging && typeof t.averaging === 'object' ? t.averaging : null,
        freqs: t.freqs.map(Number),
        levels: t.levels.map(Number)
      });
    }
    saveTraces();
    renderTraces();
    toast('Imported ' + incoming.length + ' trace(s)');
  }

  /* ---------------- named setup snapshots ----------------
     A venue is a set of choices, not a measurement: banding, scale, target,
     zoom, markers, trims and channel mode. Traces stay separate. */
  let setups = loadJSON('rtapro.setups.v1', []);
  if (!Array.isArray(setups)) setups = [];

  const SETUP_KEYS = ['averaging', 'customAvgType', 'customLowMs', 'customHighMs', 'customAllMs',
    'banding', 'scale', 'display', 'gridDb', 'lineThickness', 'traceThickness', 'trackPeak',
    'peakHold', 'yOffsetEnabled', 'offset', 'specMin', 'specMax', 'specHistory', 'specSmooth',
    'dbTop', 'dbBottom', 'fft', 'trim', 'trimB', 'showGrid', 'showLiveTrace', 'targetPreset',
    'targetOffset', 'chanMode', 'rtaSource', 'specSource', 'markA', 'markB', 'split', 'theme',
    'eqRef', 'eqSmooth', 'eqFormat'];

  function saveSetups() {
    try { localStorage.setItem('rtapro.setups.v1', JSON.stringify(setups)); }
    catch (e) { toast('Storage full — delete a setup first'); }
  }

  function renderSetups() {
    const list = $('#setupList');
    if (!list) return;
    if (!setups.length) {
      list.innerHTML = '<p class="empty">No saved setups yet. Name the room and save.</p>';
      return;
    }
    list.innerHTML = '';
    for (const s of setups) {
      const row = document.createElement('div');
      row.className = 'setupRow';
      row.innerHTML = '<span class="setupName">' + esc(s.name) + '</span>' +
        '<button class="btn" data-act="load">Load</button>' +
        '<button class="tDel" data-act="del" aria-label="Delete setup">✕</button>';
      row.querySelector('[data-act="load"]').addEventListener('click', () => applySetup(s));
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        setups = setups.filter((x) => x !== s);
        saveSetups(); renderSetups();
        toast('Deleted ' + s.name);
      });
      list.appendChild(row);
    }
  }

  function saveSetup() {
    const input = $('#setupName');
    const name = ((input && input.value) || '').trim().slice(0, 28) || 'Setup ' + (setups.length + 1);
    const snap = { name, at: Date.now(), values: {} };
    for (const k of SETUP_KEYS) snap.values[k] = S[k];
    const same = setups.findIndex((s) => s.name === name);
    if (same >= 0) setups[same] = snap; else setups.push(snap);
    saveSetups(); renderSetups();
    if (input) input.value = '';
    toast('Saved ' + name);
  }

  function applySetup(s) {
    if (!s || !s.values) return;
    const wasMode = S.chanMode;
    for (const k of SETUP_KEYS) if (k in s.values) S[k] = s.values[k];
    S.averaging = normalizeAveraging(S.averaging);
    normalizeCustomAvgState();
    rebuildBands();
    forEachAnalyser((an) => { an.fftSize = S.fft; });
    if (audio.a1) CH.a.freq = new Float32Array(audio.a1.frequencyBinCount);
    if (audio.a2) CH.b.freq = new Float32Array(audio.a2.frequencyBinCount);
    mapBands();
    resetAvg();
    resetView();
    splitFrac = clamp(typeof S.split === 'number' ? S.split : 0.42, 0.12, 0.88);
    applySplit();
    applyTheme();
    syncValues();
    saveSettings();
    if (running && !demoOn && S.chanMode !== wasMode) restartInput();
    toast('Loaded ' + s.name);
  }

  /* ---------------- reset ---------------- */
  $('#btnReset').addEventListener('click', () => {
    Object.assign(S, DEFAULTS);
    /* DEFAULTS.trims/trimsB are shared objects: hand back fresh ones so later
       trims cannot write into the defaults table */
    S.trims = {};
    S.trimsB = {};
    S.trimsM = {};
    traces = [];
    selected.clear();
    lastDeleted = null;
    customCurve = null;
    try {
      localStorage.removeItem('rtapro.settings.v1');
      localStorage.removeItem('rtapro.traces.v1');
      localStorage.removeItem('rtapro.curve.v1');
    } catch (e) {}
    forEachAnalyser((an) => { an.fftSize = S.fft; });
    CH.a.freq = audio.a1 ? new Float32Array(audio.a1.frequencyBinCount) : null;
    CH.b.freq = audio.a2 ? new Float32Array(audio.a2.frequencyBinCount) : null;
    rebuildBands();
    resetView();
    splitFrac = S.split;
    setFocus('both');
    /* a reset while paused has to put the transport back to live, or the
       state label and the rewind bar keep describing the old session */
    if (running) applyPaused(false);
    syncValues();
    applyUiMode();
    applyTheme();
    renderTraces();
    updateUndoBtn();
    if (running && !demoOn) restartInput();
    toast('Settings reset');
  });

  $('#btnUndo').addEventListener('click', () => {
    if (!lastDeleted || !lastDeleted.length) return;
    traces = traces.concat(lastDeleted);
    lastDeleted = null;
    saveTraces();
    renderTraces();
    toast('Restored');
  });

  $('#btnClearAll').addEventListener('click', () => {
    if (!traces.length) { toast('No traces to clear'); return; }
    const btn = $('#btnClearAll');
    const now = performance.now();
    if (clearArmed && now - clearArmed < 3200) {
      clearArmed = 0;
      btn.textContent = 'Clear';
      btn.classList.remove('warn');
      const n = removeTraces(traces.map((t) => t.id));
      toast('Deleted all ' + n + ' trace' + (n === 1 ? '' : 's'));
      return;
    }
    clearArmed = now;
    btn.textContent = 'Sure?';
    btn.classList.add('warn');
    toast('Tap Clear again to delete all ' + traces.length + ' traces');
    setTimeout(() => {
      if (clearArmed && performance.now() - clearArmed >= 3000) {
        clearArmed = 0;
        btn.textContent = 'Clear';
        btn.classList.remove('warn');
      }
    }, 3200);
  });

  /* ---------------- pause / rewind ---------------- */
  /* The pause control and the gate already show the state; keep it on the root
     element as a styling/debug hook instead of a redundant top-bar readout. */
  function updateState() {
    document.documentElement.dataset.state = !running ? 'idle' : S.paused ? 'paused' : 'live';
  }

  function applyPaused(p) {
    S.paused = !!p;
    setRewound(0);
    $('#pauseIcon').innerHTML = S.paused ? ICON_PLAY : ICON_PAUSE;
    $('#railPause').classList.toggle('on', S.paused);
    $('#railPause').title = S.paused ? 'Resume' : 'Pause';
    $('#railPause').setAttribute('aria-pressed', String(S.paused));
    updateState();
    if (!running || S.paused) {
      settleClear();
      if (stableCaptureArmed) setStableCaptureArmed(false);
    }
  }

  function togglePause() {
    if (!running) { toast('Press Start first'); return; }
    applyPaused(!S.paused);
  }

  /* One reset for both plots: zoom back to 20 Hz - 20 kHz, drop the Y offset,
     restore the spectrograph window, clear peak hold and return to live. The
     markers are user annotations, so they survive. */
  function resetViews() {
    resetView();
    S.yOffsetEnabled = false;
    S.offset = 0;
    S.specMin = DEFAULTS.specMin;
    S.specMax = DEFAULTS.specMax;
    S.peakHold = false;
    resetAvg();
    if (S.paused) applyPaused(false); else setRewound(0);
    syncValues();
    saveSettings();
    toast('RTA and spectrograph reset');
  }

  $('#railPause').addEventListener('click', togglePause);

  rewInput.addEventListener('input', () => setRewound(Number(rewInput.value) || 0));

  /* ---------------- full screen / wake lock ---------------- */
  $('#railFull').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) { toast('Full screen unavailable'); }
  });

  let wakeLockRef = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLockRef) {
        wakeLockRef = await navigator.wakeLock.request('screen');
        wakeLockRef.addEventListener('release', () => { wakeLockRef = null; });
      }
    } catch (e) { /* not fatal */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running) keepAwake();
  });
  window.addEventListener('online', syncChips);
  window.addEventListener('offline', syncChips);

  /* ---------------- install prompt ---------------- */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    const b = $('#btnInstall');
    if (b) b.classList.remove('hidden');
  });
  const installBtn = $('#btnInstall');
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!installEvt || typeof installEvt.prompt !== 'function') {
      toast('Use the browser menu → Add to Home screen');
      return;
    }
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) {}
    installEvt = null;
    installBtn.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    const b = $('#btnInstall');
    if (b) b.classList.add('hidden');
  });

  /* ---------------- zoom buttons ---------------- */
  $('#railZoomIn').addEventListener('click', () => zoomBy(0.65));
  $('#railZoomOut').addEventListener('click', () => zoomBy(1.55));
  $('#railViewReset').addEventListener('click', resetViews);
  $('#markZoom').addEventListener('click', zoomToMarkers);
  $('#markClear').addEventListener('click', clearMarkers);
  $('#railTrimUp').addEventListener('click', () => nudgeTrim(1));
  $('#railTrimDown').addEventListener('click', () => nudgeTrim(-1));
  $('#railTrimVal').addEventListener('click', () => {
    const key = activeTrimKey();
    if (S[key] === 0) return;
    const target = trimTargetForSlot(key === 'trimB' ? 'b' : 'a');
    setSetting(key, 0);
    toast(trimLabel(target) + ' trim reset to 0 dB');
  });
  $$('#btnAutoLevel2, #btnAutoTrimMain').forEach((b) => b.addEventListener('click', autoLevel));

  /* Infinite averaging and a peak-hold trace both keep data until something
     clears it. Live work needs that without changing the averaging mode or
     toggling the hold off and on. */
  const resetPeakBtn = $('#btnResetPeak');
  if (resetPeakBtn) resetPeakBtn.addEventListener('click', () => {
    CH.a.hold = null;
    CH.b.hold = null;
    toast('Peak hold cleared');
  });
  const resetAvgBtn = $('#btnResetAvg');
  if (resetAvgBtn) resetAvgBtn.addEventListener('click', () => {
    if (!running) { toast('Start a measurement first'); return; }
    resetAvg();
    toast('Averaging reset');
  });

  /* ---------------- input meters + status chips ---------------- */
  /* hold/holdT/node are the peak-hold tick: the max level, when it happened,
     and which analyser it belongs to (so swapping input 1+2 resets it). */
  const meter = { buf: null, t: 0, prev: 0, hold: [-Infinity, -Infinity], holdT: [0, 0], node: [null, null] };

  function meterPeak(an) {
    if (!an) return -Infinity;
    if (!meter.buf || meter.buf.length !== an.fftSize) meter.buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(meter.buf);
    let p = 0;
    for (let i = 0; i < meter.buf.length; i++) {
      const v = Math.abs(meter.buf[i]);
      if (v > p) p = v;
    }
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  }

  function syncChips() {
    const demo = $('#chipDemo'), off = $('#chipOffline');
    if (demo) demo.classList.toggle('hidden', !(running && demoOn));
    if (off) off.classList.toggle('hidden', navigator.onLine !== false);
  }

  /* A ten-times-a-second peak meter on the real time-domain signal, so silence,
     a dead channel or a clipped input is visible without opening anything. */
  function updateMeters(t) {
    const wrap = $('#liveMeters');
    if (!wrap) return;
    const show = running && !demoOn && !!audio.a1;
    wrap.classList.toggle('hidden', !show);
    syncChips();
    if (!show || t - meter.t < 90) return;
    meter.t = t;
    const dual = isDual();
    wrap.classList.toggle('mono', !dual);
    const bars = [$('#lm1'), $('#lm2')];
    const ticks = [$('#lm1Peak'), $('#lm2Peak')];
    const nodes = [audio.a1, dual ? audio.a2 : null];
    const dt = meter.prev ? Math.min(0.5, (t - meter.prev) / 1000) : 0;
    meter.prev = t;
    let loud = -Infinity;
    for (let k = 0; k < 2; k++) {
      const bar = bars[k];
      const tick = ticks[k];
      if (!bar) continue;
      if (!nodes[k]) {
        bar.style.width = '0%';
        if (tick) tick.style.display = 'none';
        meter.hold[k] = -Infinity;
        meter.node[k] = null;
        continue;
      }
      if (meter.node[k] !== nodes[k]) {
        meter.node[k] = nodes[k];
        meter.hold[k] = -Infinity;
        meter.holdT[k] = t;
      }
      const db = meterPeak(nodes[k]);
      bar.style.width = clamp((db + 60) / 60, 0, 1) * 100 + '%';
      bar.classList.toggle('clip', db > -0.5);
      if (db > loud) loud = db;
      /* Hold the maximum for 1.2 s, then let it fall at 18 dB/s; a transient
         that the 90 ms bar sampling would miss stays visible on the tick. */
      if (db >= meter.hold[k]) {
        meter.hold[k] = db;
        meter.holdT[k] = t;
      } else if (t - meter.holdT[k] > 1200) {
        meter.hold[k] = Math.max(db, meter.hold[k] - 18 * dt);
      }
      if (tick) {
        if (isFinite(meter.hold[k])) {
          const p = clamp((meter.hold[k] + 60) / 60, 0, 1) * 100;
          tick.style.display = 'block';
          tick.style.left = 'calc(' + p + '% - 1px)';
        } else {
          tick.style.display = 'none';
        }
      }
    }
    /* Phone-width readout: the bars are only 33px there, so the number carries
       the precision. Hidden by CSS on wider screens, where the bars are long. */
    const val = $('#lmVal');
    if (val) val.textContent = isFinite(loud) ? loud.toFixed(1) : '—';
  }

  /* ---------------- toast ---------------- */
  let toastTimer = 0;
  let toastAction = null;
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.classList.add('hidden');
    toastAction = null;
    if (toastActionBtn) toastActionBtn.classList.add('hidden');
  }
  function toast(msg, action) {
    if (toastMsg) toastMsg.textContent = msg;
    else toastEl.textContent = msg;
    toastAction = action || null;
    toastEl.classList.toggle('warn', !!(action && action.warn));
    if (toastActionBtn) {
      toastActionBtn.textContent = toastAction ? toastAction.label : '';
      toastActionBtn.title = toastAction ? (toastAction.title || toastAction.label) : '';
      toastActionBtn.classList.toggle('hidden', !toastAction);
    }
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, toastAction ? 6500 : 1900);
  }
  if (toastActionBtn) {
    toastActionBtn.addEventListener('click', () => {
      const action = toastAction;
      if (!action) return;
      hideToast();
      action.run();
    });
  }

  /* ---------------- auto level ----------------
     A browser has no analog gain: everything after the OS capture is digital.
     So this does not make the input hotter, it moves the trace to where you
     can read it by changing Input Trim, and says so plainly. */
  let autoProbe = 0;
  let autoUndo = null;
  const autoButtons = $$('#btnAutoLevel2, #btnAutoTrimMain');
  const AUTO_SIGNAL_FLOOR = -170;

  /* Rail stepper: one decibel per tap. Auto Trim handles the coarse move.
     The rail always trims the input the RTA is showing, which is input 1
     unless 1+2 is on and the RTA is pointed at input 2. */
  function activeTrimKey() {
    return (isDual() && S.rtaSource === 'b') ? 'trimB' : 'trim';
  }
  function activeTrim() { return S[activeTrimKey()]; }

  /* Trims follow capture channels, not analyzer lanes: Left, Right, and a
     separate Mix bucket for a summed stereo input. A mono input is channel 1. */
  function trimTargetForSlot(slot) {
    const capture = captureChannelForSlot(slot);
    if (capture) return capture;
    return slot === 'a' ? 'M' : null;
  }

  function trimLabel(target) {
    if (target === 'R') return 'Right channel';
    if (target === 'M') return 'Mix';
    return audio.chans === 1 ? 'Channel 1' : 'Left channel';
  }

  function trimShortLabel(target) {
    if (target === 'R') return 'R';
    if (target === 'M') return 'MIX';
    return audio.chans === 1 ? 'CH1' : 'L';
  }

  function trimStore(target) {
    if (target === 'R') return S.trimsB;
    if (target === 'M') return S.trimsM;
    return target === 'L' ? S.trims : null;
  }

  function storedTrim(id, target) {
    if (!target) return 0;
    let value = trimStore(target)[id];
    /* Mix had no separate bucket before capture-channel trims; use the old
       lane-a value until a mix trim is set explicitly. */
    if (target === 'M' && (typeof value !== 'number' || !isFinite(value))) value = S.trims[id];
    return (typeof value === 'number' && isFinite(value)) ? clamp(value, -24, 24) : 0;
  }

  function setStoredTrim(id, target, value) {
    const store = trimStore(target);
    if (store) store[id] = value;
  }

  /* The RTA can show one input or both. The trim always follows the capture
     channel the RTA is reading, so name that target everywhere it appears. */
  function trimTarget() {
    const dual = isDual();
    const slot = activeTrimKey() === 'trimB' ? 'b' : 'a';
    const target = trimTargetForSlot(slot) || 'L';
    const label = trimLabel(target);
    return {
      dual,
      target,
      short: (dual ? '1+2\u00b7' : '') + trimShortLabel(target),
      full: (dual ? '1+2 overlay \u2014 ' : '') +
        'Auto Trim adjusts ' + label.toLowerCase() + ' trim'
    };
  }

  function syncTrimUI() {
    const a = trimTargetForSlot('a') || 'L';
    const b = trimTargetForSlot('b');
    const labelA = $('#trimLabelA');
    const labelB = $('#trimLabelB');
    const rowB = $('#trimRowB');
    if (labelA) labelA.textContent = trimLabel(a) + ' trim';
    if (labelB) labelB.textContent = (b ? trimLabel(b) : 'Right channel') + ' trim';
    if (rowB) rowB.classList.toggle('hidden', !b || b === a);
  }

  function syncInputSource() {
    const t = trimTarget();
    const label = trimLabel(t.target);
    $$('[data-trim-source]').forEach((el) => {
      el.textContent = t.short;
      el.title = t.full;
      el.setAttribute('aria-label', t.full);
    });
    const rv = $('#railTrimVal');
    if (rv) {
      rv.title = label + ' trim \u2014 tap to reset to 0 dB';
      rv.setAttribute('aria-label', label + ' trim, tap to reset');
    }
    const up = $('#railTrimUp');
    if (up) {
      up.title = 'Increase ' + label.toLowerCase() + ' trim 1 dB';
      up.setAttribute('aria-label', 'Increase ' + label.toLowerCase() + ' trim');
    }
    const down = $('#railTrimDown');
    if (down) {
      down.title = 'Decrease ' + label.toLowerCase() + ' trim 1 dB';
      down.setAttribute('aria-label', 'Decrease ' + label.toLowerCase() + ' trim');
    }
    const autoTitle = 'Auto gain trim \u2014 adjusts ' + label.toLowerCase() + ' trim' +
      (t.dual ? ' (1+2 overlay)' : '');
    $$('#btnAutoLevel2, #btnAutoTrimMain').forEach((b) => {
      b.title = autoTitle;
      b.setAttribute('aria-label', 'Auto Trim \u2014 adjusts ' + label.toLowerCase() + ' trim');
    });
  }

  function nudgeTrim(step) {
    const key = activeTrimKey();
    const target = trimTargetForSlot(key === 'trimB' ? 'b' : 'a');
    const label = trimLabel(target);
    const cur = S[key];
    const next = clamp(cur + step, -24, 24);
    if (next === cur) {
      toast(label + ' trim already at ' + (cur > 0 ? '+24' : '-24') + ' dB');
      return;
    }
    setSetting(key, next);
  }

  /* One trim per input device and capture channel: a measurement mic on an
     interface and the tablet's own mic do not need the same number. */
  function applyStoredTrim() {
    const id = S.micId || 'default';
    S.trim = storedTrim(id, trimTargetForSlot('a'));
    S.trimB = isDual() ? storedTrim(id, trimTargetForSlot('b')) : 0;
    syncValues();
  }

  function setAutoReading(on) {
    autoButtons.forEach((b) => {
      b.classList.toggle('reading', on);
      b.disabled = on;
      b.setAttribute('aria-busy', String(on));
      b.textContent = on ? 'Reading\u2026' : 'Auto Trim';
    });
  }

  function signedTrim(v) {
    return (v > 0 ? '+' : '') + v + ' dB';
  }

  function undoAutoTrim() {
    const u = autoUndo;
    if (!u) return;
    autoUndo = null;
    const id = S.micId || 'default';
    const label = trimLabel(u.target);
    if (u.id !== id || S[u.key] !== u.applied ||
        trimTargetForSlot(u.key === 'trimB' ? 'b' : 'a') !== u.target) {
      toast(label + ' trim changed since Auto Trim \u2014 undo unavailable');
      return;
    }
    setStoredTrim(u.id, u.target, u.before);
    S[u.key] = u.before;
    saveSettings();
    syncValues();
    resetAvg();
    toast('Auto Trim undone \u00b7 ' + label + ' trim ' + signedTrim(u.before));
  }

  function autoLevelApply(samples, key, id, target) {
    const label = trimLabel(target);
    const vals = samples.filter((v) => isFinite(v)).sort((a, b) => a - b);
    if (!vals.length || vals[vals.length - 1] < AUTO_SIGNAL_FLOOR) {
      toast('No signal on ' + label.toLowerCase() + ' \u2014 check the input');
      return;
    }
    /* median of the per-frame maxima: one transient should not set it */
    const peak = vals[vals.length >> 1];
    const oldTrim = S[key];
    const targetDb = clamp(S.dbTop - 6, S.dbBottom + 6, 0);
    const next = clamp(Math.round(oldTrim + (targetDb - peak)), -24, 24);
    const atLimit = next === 24 || next === -24;
    if (next === oldTrim) {
      toast(atLimit
        ? label + ' trim already at ' + signedTrim(next) + ' limit \u2014 lower the input'
        : label + ' level already fits the plot');
      return;
    }
    S[key] = next;
    setStoredTrim(id, target, next);
    saveSettings();
    syncValues();
    /* the running average and peak hold still carry the old trim */
    resetAvg();
    autoUndo = { key, id, target, before: oldTrim, applied: next };
    toast(label + ' trim ' + (oldTrim > 0 ? '+' : '') + oldTrim + ' \u2192 ' + signedTrim(next) +
      ' \u00b7 peak now ' + Math.round(peak - oldTrim + next) + ' dBFS' +
      (atLimit ? ' \u00b7 ' + signedTrim(next) + ' limit reached' : ''), {
      label: 'Undo', run: undoAutoTrim, warn: atLimit
    });
  }

  function autoLevel() {
    const src = rtaChan();
    if (!running || !src.avg.data) { toast('Start a measurement first'); return; }
    if (autoProbe) return;   /* ignore a double tap while it is sampling */
    const key = activeTrimKey();
    const id = S.micId || 'default';
    const target = trimTargetForSlot(key === 'trimB' ? 'b' : 'a');
    autoProbe = performance.now();
    setAutoReading(true);
    toast('Reading ' + trimLabel(target).toLowerCase() + ' level\u2026');
    const samples = [];
    const iv = setInterval(() => {
      const d = rtaChan().avg.data;
      if (d) {
        let m = -Infinity;
        for (let i = 0; i < d.length; i++) if (d[i] > m) m = d[i];
        if (isFinite(m)) samples.push(m);
      }
      if (performance.now() - autoProbe >= 800) {
        clearInterval(iv);
        autoProbe = 0;
        setAutoReading(false);
        if (activeTrimKey() !== key || (S.micId || 'default') !== id ||
            trimTargetForSlot(key === 'trimB' ? 'b' : 'a') !== target) {
          toast('Input changed \u2014 Auto Trim cancelled');
          return;
        }
        autoLevelApply(samples, key, id, target);
      }
    }, 60);
  }

  /* ---------------- demo signal ---------------- */
  /* A realistic programme signal: quiet noise floor, a shaped mid range that
     breathes, tonal peaks that drift, and transients. A perfectly smooth
     spectrum would make the spectrograph a featureless wash. */
  function demoLevels(out, key) {
    const t = performance.now() / 1000;
    const second = key === 'b';
    for (let i = 0; i < out.length; i++) {
      const f = bands[i].fc;
      const l2 = Math.log2(f / 500);

      /* noise floor, slightly pink */
      let v = -74 - 1.5 * l2;

      /* programme energy that swells and fades */
      const env = 0.6 + 0.4 * Math.sin(t * 0.35 + (second ? 0.8 : 0));
      v += env * (second ? 30 : 34) * Math.exp(-Math.pow(l2 / 2.1, 2));

      /* moving tonal peaks */
      const drift = 118 * (1 + 0.15 * Math.sin(t * 0.22));
      v += (second ? 18 : 26) * Math.exp(-Math.pow(Math.log2(f / drift), 2) * 55);
      v += 18 * Math.exp(-Math.pow(Math.log2(f / (second ? 1250 : 2600)), 2) * 70) *
        (0.5 + 0.5 * Math.sin(t * 0.6));

      /* transients every ~1.7 s so the time axis shows structure scrolling up */
      const burst = Math.max(0, Math.sin(t * 1.7));
      v += 12 * Math.pow(burst, 8) * Math.exp(-Math.pow(l2 - 1.2, 2) * 3);

      /* the console feed on input 2: flatter and a little quieter than the mic,
         so the 1+2 overlay has something to show without a microphone */
      if (second) v += 3 - 0.6 * l2;

      v += (Math.random() - 0.5) * 3.5;
      out[i] = v;
    }
    return out;
  }

  /* ---------------- measurement ---------------- */
  /* Input handling: a browser can only use what the OS exposes, but we can
     choose the device and pick channel 0 or 1 of a stereo interface. */
  function micConstraints(withDevice) {
    const c = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };
    /* only ask for two channels when a specific channel was chosen: a mono
       microphone otherwise fails the request on stricter browsers */
    if (S.chanMode !== 'mix') c.channelCount = 2;
    if (withDevice !== false && S.micId) c.deviceId = { exact: S.micId };
    return c;
  }

  /* Open the microphone, loosening the request step by step. A device id saved
     in an earlier session can stop existing (browsers rotate ids, interfaces
     get unplugged), and an exact deviceId then fails with NotFoundError. That
     must never lock the user out of the analyzer. */
  async function openMicStream() {
    const tries = [];
    if (S.micId) tries.push(micConstraints(true));
    tries.push(micConstraints(false));
    tries.push({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });

    let lastErr = null;
    for (const want of tries) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: want, video: false });
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState === 'ended') throw new Error('no audio track');
        return stream;
      } catch (err) {
        lastErr = err;
        const name = err && err.name;
        /* permission or "device busy" will not be fixed by looser constraints */
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotReadableError') throw err;
        /* the remembered device is gone: forget it and use the default */
        if (S.micId) { S.micId = ''; saveSettings(); }
      }
    }
    throw lastErr || new Error('No microphone available');
  }

  function micErrorText(err) {
    switch (err && err.name) {
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No microphone was found on this device. Plug in an input or enable the built-in microphone, then press Start again — ' +
          'or use the demo signal to explore the analyzer.';
      case 'NotAllowedError':
        return 'Microphone permission is blocked. Allow it for this site (browser address bar → permissions), reload, then press Start again.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'The microphone is busy — another app or tab is holding it. Close that, then press Start again.';
      case 'OverconstrainedError':
        return 'This input could not be opened with the requested channel setting. Pick another input in Settings, then press Start again.';
      case 'SecurityError':
        return 'The browser blocked microphone access on this address. Open the app over HTTPS (the published link), not a local file.';
      default:
        return 'Microphone error: ' + ((err && err.message) || err);
    }
  }

  function connectSource(stream) {
    const inputGeneration = ++audio.gen;
    audio.stream = stream;
    audio.src = audio.ctx.createMediaStreamSource(stream);
    try {
      audio.src.channelCount = 2;
      audio.src.channelCountMode = 'explicit';
    } catch (e) { /* mono input */ }
    /* a mono input has no right channel: picking R or 1+2 would measure
       silence on one side, so fall back to the single channel and say so */
    const track = stream.getAudioTracks()[0];
    if (track && track.addEventListener) {
      track.addEventListener('ended', () => {
        if (audio.gen !== inputGeneration || !running || demoOn) return;
        handleInputEnded();
      });
    }
    const settings = track && track.getSettings ? track.getSettings() : {};
    const chans = settings.channelCount || 1;
    audio.chans = chans;
    /* Calibration follows the stream that is actually open, not only the
       remembered selection: a fallback stream may be a different device. */
    audio.deviceId = settings.deviceId || '';
    audio.label = (track && track.label) || '';
    if (audio.deviceId && audio.deviceId !== S.micId) {
      S.micId = audio.deviceId;
      saveSettings();
    }
    const a1 = audio.a1, a2 = audio.a2;
    if (isDual()) {
      if (chans < 2) {
        audio.src.connect(a1);
        audio.src.connect(a2);
        toast('Input is mono — both inputs show the same signal');
      } else {
        const sp = audio.ctx.createChannelSplitter(2);
        audio.src.connect(sp);
        sp.connect(a1, 0);
        sp.connect(a2, 1);
        audio.splitter = sp;
      }
    } else if (S.chanMode === 'mix' || chans < 2) {
      audio.src.connect(a1);
      if (S.chanMode !== 'mix' && chans < 2) toast('Input is mono — measuring its only channel');
    } else {
      const sp = audio.ctx.createChannelSplitter(2);
      audio.src.connect(sp);
      sp.connect(a1, S.chanMode === 'L' ? 0 : 1);
      audio.splitter = sp;
    }
  }

  async function restartInput() {
    if (!audio.ctx || demoOn) return;
    try {
      /* invalidate the old track's ended listener before stopping it */
      audio.gen++;
      if (audio.src) { try { audio.src.disconnect(); } catch (e) {} }
      if (audio.splitter) { try { audio.splitter.disconnect(); } catch (e) {} audio.splitter = null; }
      if (audio.stream) audio.stream.getTracks().forEach((t) => t.stop());
      const stream = await openMicStream();
      connectSource(stream);
      applyStoredTrim();
      resetAvg();
      await populateInputs();
      toast('Input re-opened' + (S.chanMode === 'mix' ? '' : ' (' + S.chanMode + ')') );
    } catch (err) {
      /* the old stream is already gone, so carrying on would show a flat line
         forever: say what happened and hand the start screen back */
      audio.chans = 0;
      audio.deviceId = '';
      audio.label = '';
      running = false;
      S.paused = false;
      updateState();
      gateMsg.className = 'gateMsg';
      gateMsg.textContent = micErrorText(err);
      gate.classList.remove('hidden');
      applyPaused(false);
    }
  }

  function handleInputEnded() {
    if (!running || demoOn) return;
    /* The stream is gone but the remembered selection is not evidence that
       the calibration still applies. Fail closed and surface the guard. */
    audio.deviceId = '';
    audio.chans = 0;
    audio.label = '';
    syncMicCalibration();
    const hasActive = Object.keys(activeMicCalibrations).some((key) => activeMicCalibrations[key]);
    toast(hasActive ? 'Input disconnected — calibration cannot be confirmed' : 'Input disconnected', { warn: true });
  }

  async function populateInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const sel = $('#micSelect');
    if (!sel) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const ins = devices.filter((d) => d.kind === 'audioinput');
      sel.innerHTML = '';
      if (!ins.length) {
        sel.innerHTML = '<option value="">No inputs visible</option>';
        syncMicCalibration();
        return;
      }
      ins.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Input ' + (i + 1);
        sel.appendChild(o);
      });
      const keep = ins.some((d) => d.deviceId === S.micId);
      sel.value = keep ? S.micId : ins[0].deviceId;
      if (!keep) { S.micId = sel.value; saveSettings(); }
      syncMicCalibration();
    } catch (e) { /* enumeration blocked until permission */ }
  }

  let starting = false;
  async function startMic() {
    /* a double tap must not open two contexts and two microphones */
    if (starting) return;
    gateMsg.className = 'gateMsg';
    if (!window.isSecureContext) {
      gateMsg.textContent = 'Microphone blocked: this page is not a secure context. Open it over HTTPS, or on localhost. ' +
        'You can still explore the interface with the demo signal.';
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      gateMsg.textContent = 'This browser does not expose microphone capture. Try Chrome.';
      return;
    }
    starting = true;
    try {
      gateMsg.textContent = 'Waiting for microphone permission…';
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      await ctx.resume();
      audio.ctx = ctx;
      ctx.addEventListener('statechange', () => syncMicCalibration());

      const a1 = ctx.createAnalyser();
      a1.fftSize = S.fft;
      a1.smoothingTimeConstant = 0;
      const a2 = ctx.createAnalyser();
      a2.fftSize = S.fft;
      a2.smoothingTimeConstant = 0;
      audio.a1 = a1;
      audio.a2 = a2;

      const stream = await openMicStream();
      connectSource(stream);
      CH.a.freq = new Float32Array(a1.frequencyBinCount);
      CH.b.freq = new Float32Array(a2.frequencyBinCount);
      await populateInputs();

      mapBands();
      applyStoredTrim();
      resetAvg();
      running = true;
      S.paused = false;
      demoOn = false;
      gate.classList.add('hidden');
      /* a session paused during an earlier visit must not come back frozen */
      applyPaused(false);
      syncMicCalibration();
      updateInfo();
      keepAwake();
    } catch (err) {
      /* leave nothing half-open behind, so a retry starts from a clean slate */
      if (audio.ctx) { try { audio.ctx.close(); } catch (e) {} }
      audio.ctx = null;
      audio.a1 = null;
      audio.a2 = null;
      audio.src = null;
      audio.stream = null;
      audio.chans = 0;
      audio.deviceId = '';
      audio.label = '';
      running = false;
      gateMsg.className = 'gateMsg';
      gateMsg.textContent = micErrorText(err);
      console.warn('microphone start failed:', err && err.name, err && err.message);
    } finally {
      starting = false;
    }
  }

  $('#btnStart').addEventListener('click', startMic);

  $('#micSelect').addEventListener('change', (e) => {
    S.micId = e.target.value;
    micCalibrationError = '';
    applyStoredTrim();
    renderMicCalibrationList();
    syncMicCalibration();
    saveSettings();
    if (running && !demoOn) restartInput();
  });

  let micCalibrationError = '';
  function normalizeCalibrationChannel(channel) {
    return channel === 'L' || channel === 'R' ? channel : null;
  }

  function calibrationKey(deviceId, channel) {
    const ch = normalizeCalibrationChannel(channel);
    return deviceId && ch ? deviceId + ':' + ch : null;
  }

  function micCalibrationFor(deviceId, channel) {
    const key = calibrationKey(deviceId, channel);
    return key ? activeMicCalibrations[key] || null : null;
  }

  function calibrationDeviceId(streaming = running, demo = demoOn, streamId = audio.deviceId, selected = S.micId) {
    /* A live stream's own ID is authoritative. If it reports none, fail closed
       instead of borrowing the curve saved for the selected device. */
    return streaming && !demo ? (streamId || '') : selected;
  }

  /* Analyzer lanes a/b are not physical devices. 1+2 maps them to the selected
     device's left and right channels, Left/Right modes feed either capture
     channel into lane a, and a stereo Mix sums both channels in lane a. A mono
     input has one capture channel, so it is always the left/channel-1 curve. */
  function captureChannelForSlot(slot, mode = S.chanMode, chans = audio.chans) {
    if (chans === 1) return 'L';
    if (mode === 'dual') return slot === 'b' ? 'R' : 'L';
    if (mode === 'L') return 'L';
    if (mode === 'R') return 'R';
    return null;
  }

  function calibrationAppliedTo(channel) {
    return captureChannelForSlot('a') === channel ||
      (isDual() && captureChannelForSlot('b') === channel);
  }

  function syncMicCalibration(message) {
    const status = $('#micCalibrationStatus');
    const remove = $('#btnRemoveMicCalibration');
    if (!status || !remove) return;
    const channel = normalizeCalibrationChannel($('#micCalibrationChannel').value) || 'L';
    const deviceId = calibrationDeviceId();
    const calibration = micCalibrationFor(deviceId, channel);
    const saved = micCalibrations[calibrationKey(deviceId, channel)];
    const applyBox = $('#micCalibrationApply');
    if (applyBox) applyBox.checked = !micCalibrationBypassed;
    let text = message || micCalibrationError;
    if (!text) {
      if (!deviceId) {
        text = running && !demoOn
          ? 'The active input does not report a device ID, so calibration is disabled.'
          : 'Select an input device to load a calibration.';
      } else if (calibration) {
        const channelName = channel === 'R' ? 'right channel (2)' : 'left channel (1)';
        const modeName = { mix: 'Mix', L: 'Left', R: 'Right', dual: '1+2' }[S.chanMode] || S.chanMode;
        text = calibration.name + ' · ' + calibration.points.length + ' points · ' + channelName +
          (micCalibrationBypassed ? ' · bypassed'
            : calibrationAppliedTo(channel) ? '' : ' · not applied in ' + modeName + ' mode');
      } else if (saved) {
        text = 'Saved calibration is inactive. Use it for this input, or load a file to replace it.';
      } else {
        text = 'No calibration file for this channel.';
      }
    }
    status.textContent = text;
    status.classList.toggle('calError', !!(message || micCalibrationError));
    const list = $('#micCalibrationSaved');
    remove.disabled = !(list && list.value);
    syncCalibrationBadge();
    syncCalibrationGuard();
  }

  function calibrationChannelLabel(channel) {
    return channel === 'R' ? 'right' : 'left';
  }

  function currentDeviceLabel() {
    const sel = $('#micSelect');
    if (sel && sel.selectedIndex >= 0) {
      const opt = sel.options[sel.selectedIndex];
      if (opt && opt.value && opt.value === S.micId && opt.textContent) return opt.textContent;
    }
    return audio.label || '';
  }

  function savedCalibrationLabel(deviceId, entry) {
    if (entry && entry.label) return entry.label;
    if (deviceId === S.micId) {
      const current = currentDeviceLabel();
      if (current) return current;
    }
    return 'Saved input';
  }

  function renderMicCalibrationList() {
    const list = $('#micCalibrationSaved');
    if (!list) return;
    const previous = list.value;
    const keys = Object.keys(micCalibrations).filter((key) => /:[LR]$/.test(key));
    list.innerHTML = '';
    if (!keys.length) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No saved calibrations';
      list.appendChild(empty);
      list.disabled = true;
      const useEmpty = $('#btnUseMicCalibration');
      if (useEmpty) useEmpty.disabled = true;
      return;
    }
    list.disabled = false;
    keys.sort((a, b) => {
      const al = savedCalibrationLabel(a.slice(0, -2), micCalibrations[a]) + ' ' + a.slice(-1);
      const bl = savedCalibrationLabel(b.slice(0, -2), micCalibrations[b]) + ' ' + b.slice(-1);
      return al.localeCompare(bl);
    });
    for (const key of keys) {
      const entry = micCalibrations[key];
      const channel = key.slice(-1);
      const deviceId = key.slice(0, -2);
      const option = document.createElement('option');
      option.value = key;
      option.textContent = savedCalibrationLabel(deviceId, entry) + ' · ' +
        calibrationChannelLabel(channel) + ' · ' + (entry.name || 'Calibration');
      list.appendChild(option);
    }
    if (keys.indexOf(previous) >= 0) list.value = previous;
    else {
      const currentKey = calibrationKey(calibrationDeviceId(), $('#micCalibrationChannel').value);
      if (currentKey && keys.indexOf(currentKey) >= 0) list.value = currentKey;
    }
    const use = $('#btnUseMicCalibration');
    if (use) use.disabled = !list.value;
  }

  function syncCalibrationBadge() {
    const badge = $('#calBadge');
    if (!badge) return;
    const deviceId = calibrationDeviceId();
    const channels = [];
    if (deviceId) {
      for (const slot of isDual() ? ['a', 'b'] : ['a']) {
        const channel = captureChannelForSlot(slot);
        if (channel && micCalibrationFor(deviceId, channel) && channels.indexOf(channel) < 0) channels.push(channel);
      }
    }
    const sessionActive = Object.keys(activeMicCalibrations).some((key) => activeMicCalibrations[key]);
    if (demoOn || (!channels.length && !sessionActive)) {
      badge.classList.add('hidden');
      return;
    }
    if (!channels.length) {
      /* The banner can be dismissed; this badge stays as the persistent
         reminder that a session-active curve is not being applied. */
      badge.textContent = micCalibrationBypassed ? 'CAL OFF' : 'CAL !';
      badge.classList.toggle('off', micCalibrationBypassed);
      badge.classList.toggle('inactive', !micCalibrationBypassed);
      badge.classList.remove('hidden');
      badge.title = micCalibrationBypassed
        ? 'Calibration bypassed'
        : 'Active calibration is not applied to the current input';
      return;
    }
    const names = channels.map((channel) =>
      calibrationChannelLabel(channel) + ': ' + micCalibrationFor(deviceId, channel).name);
    badge.textContent = micCalibrationBypassed ? 'CAL OFF' : 'CAL ' + channels.join('+');
    badge.classList.toggle('off', micCalibrationBypassed);
    badge.classList.remove('inactive');
    badge.classList.remove('hidden');
    badge.title = (micCalibrationBypassed ? 'Calibration bypassed' : 'Calibration active') +
      ' — ' + names.join(' · ') + (currentDeviceLabel() ? ' · ' + currentDeviceLabel() : '');
  }

  function rememberActiveCalibration(key) {
    if (key && activeMicCalibrations[key]) lastActiveCalibrationKey = key;
  }

  function forgetActiveCalibration(key) {
    if (lastActiveCalibrationKey !== key) return;
    const keys = Object.keys(activeMicCalibrations);
    lastActiveCalibrationKey = keys.length ? keys[keys.length - 1] : '';
  }

  function activeCalibrationEntry(key) {
    if (!key || !activeMicCalibrations[key]) return null;
    const channel = normalizeCalibrationChannel(key.slice(-1));
    return channel ? { key, channel, entry: activeMicCalibrations[key] } : null;
  }

  function activeCalibrationEntries(deviceId) {
    if (!deviceId) return [];
    return Object.keys(activeMicCalibrations)
      .filter((key) => key.slice(0, -2) === deviceId && /:[LR]$/.test(key) && activeMicCalibrations[key])
      .sort((a, b) => a.slice(-1).localeCompare(b.slice(-1)))
      .map(activeCalibrationEntry)
      .filter(Boolean);
  }

  function lastActiveCalibrationDeviceId() {
    let key = lastActiveCalibrationKey;
    if (!key || !activeMicCalibrations[key]) {
      const keys = Object.keys(activeMicCalibrations).filter((k) => activeMicCalibrations[k]);
      key = keys.length ? keys[keys.length - 1] : '';
    }
    return key ? key.slice(0, -2) : '';
  }

  function calibrationChannelPhrase(channels) {
    const list = (channels || []).filter((channel, index, all) => all.indexOf(channel) === index);
    if (!list.length) return 'the selected channel';
    if (list.length > 1) return 'left and right channels';
    return calibrationChannelLabel(list[0]) + ' channel';
  }

  function calibrationModeLabel(mode) {
    return { mix: 'Mix', L: 'Left', R: 'Right', dual: '1+2' }[mode] || mode;
  }

  function calibrationModeName() {
    return calibrationModeLabel(S.chanMode);
  }

  function analyzedCalibrationChannels() {
    const channels = [];
    const slots = isDual() ? ['a', 'b'] : ['a'];
    for (const slot of slots) {
      const channel = captureChannelForSlot(slot);
      if (channel && channels.indexOf(channel) < 0) channels.push(channel);
    }
    return channels;
  }

  function calibrationGuardInfo() {
    if (micCalibrationBypassed || demoOn) return null;
    const activeKeys = Object.keys(activeMicCalibrations).filter((key) => activeMicCalibrations[key]);
    if (!activeKeys.length) return null;

    const currentId = calibrationDeviceId();
    const analyzed = analyzedCalibrationChannels();
    const currentEntries = activeCalibrationEntries(currentId);
    if (currentEntries.some((item) => analyzed.indexOf(item.channel) >= 0)) return null;

    let reason;
    let sourceEntries;
    if (!currentId) {
      reason = 'no-id';
      sourceEntries = activeCalibrationEntries(lastActiveCalibrationDeviceId());
    } else if (!currentEntries.length) {
      reason = 'device';
      sourceEntries = activeCalibrationEntries(lastActiveCalibrationDeviceId());
    } else {
      reason = !analyzed.length && S.chanMode === 'mix'
        ? 'mix'
        : audio.chans === 1 && currentEntries.every((item) => item.channel === 'R')
          ? 'mono'
          : 'channel';
      sourceEntries = currentEntries;
    }
    if (!sourceEntries.length) sourceEntries = activeKeys.map(activeCalibrationEntry).filter(Boolean);
    if (!sourceEntries.length) return null;

    const sourceChannels = sourceEntries.map((item) => item.channel);
    const sourcePhrase = calibrationChannelPhrase(sourceChannels);
    const sourceLabel = sourceEntries[0].entry && sourceEntries[0].entry.label
      ? sourceEntries[0].entry.label
      : 'the previous input';
    const currentLabel = currentDeviceLabel() || currentId || 'this input';
    const hasLeft = sourceChannels.indexOf('L') >= 0;
    const hasRight = sourceChannels.indexOf('R') >= 0;
    /* 1+2 already analyzes both capture channels, so a left-only or
       right-only curve applies without narrowing the measurement to one
       channel. Keep that mode instead of dropping the other input. */
    const relinkMode = S.chanMode === 'dual' || (hasLeft && hasRight)
      ? 'dual'
      : hasRight ? 'R' : 'L';
    const monoOnlyRight = audio.chans === 1 && !hasLeft;
    const canRelink = !!(currentId && !monoOnlyRight);
    const canReopen = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasSaved = Object.keys(micCalibrations).some((key) => /:[LR]$/.test(key));
    const modeName = calibrationModeName();
    let message;
    if (reason === 'no-id') {
      message = 'The input is not reporting a device ID, so the active calibration is not applied. ' +
        'Reopen the input, then relink or use a saved curve.';
    } else if (reason === 'device') {
      message = 'Calibration is active for ' + sourceLabel + ' (' + sourcePhrase + '), but the current input is ' +
        currentLabel + '. It is not applied.';
    } else if (reason === 'mix') {
      message = 'Calibration is active for ' + sourcePhrase + ', but stereo Mix sums both channels, so it is not applied. ' +
        'Relink switches to ' + ({ L: 'Left', R: 'Right', dual: '1+2' }[relinkMode] || modeName) + ' mode.';
    } else if (reason === 'mono') {
      message = 'Calibration is active for the right channel, but this input is mono; only a left/channel-1 curve can be applied.';
    } else {
      message = 'Calibration is active for ' + sourcePhrase + ', but ' + modeName + ' mode analyzes ' +
        calibrationChannelPhrase(analyzed) + '. It is not applied.';
    }
    const signature = [
      reason, currentId, S.chanMode, String(audio.chans), analyzed.join(''),
      sourceEntries.map((item) => item.key).join(','), activeKeys.slice().sort().join(',')
    ].join('|');
    return { reason, message, canRelink, canReopen, hasSaved, relinkMode, sourceEntries, currentId, signature };
  }

  function relinkPreviewMessage(info) {
    const targetId = calibrationDeviceId();
    const targetKeys = info.sourceEntries
      .map((item) => calibrationKey(targetId, item.channel))
      .filter(Boolean);
    const replaces = targetKeys.some((key) => !!micCalibrations[key]);
    const sourceLabel = info.sourceEntries[0].entry && info.sourceEntries[0].entry.label
      ? info.sourceEntries[0].entry.label
      : 'the previous input';
    const targetLabel = currentDeviceLabel() || targetId || 'this input';
    const channels = info.sourceEntries.map((item) => item.channel);
    let message = 'Relink ' + sourceLabel + ' (' + calibrationChannelPhrase(channels) + ') to ' +
      targetLabel + '?';
    if (replaces) message += ' This replaces the target saved curve for ' +
      calibrationChannelPhrase(channels) + '.';
    if (info.relinkMode !== S.chanMode) {
      message += ' It will switch to ' + calibrationModeLabel(info.relinkMode) + ' mode.';
    } else {
      message += ' ' + calibrationModeLabel(S.chanMode) + ' mode stays selected.';
    }
    return message;
  }

  function syncCalibrationGuard() {
    if (!calGuardEl || !calGuardTextEl || !calGuardRelinkBtn || !calGuardUseBtn || !calGuardDismissBtn) return;
    const info = calibrationGuardInfo();
    if (!info) {
      calibrationGuardDismissed = '';
      calibrationGuardPreview = null;
      calGuardEl.classList.add('hidden');
      calGuardEl.setAttribute('aria-hidden', 'true');
      return;
    }
    if (calibrationGuardPreview && calibrationGuardPreview.signature !== info.signature) {
      calibrationGuardPreview = null;
    }
    if (calibrationGuardDismissed === info.signature && !calibrationGuardPreview) {
      calGuardEl.classList.add('hidden');
      calGuardEl.setAttribute('aria-hidden', 'true');
      return;
    }
    const preview = calibrationGuardPreview;
    if (preview) {
      calGuardTextEl.textContent = preview.message;
      calGuardRelinkBtn.textContent = 'Confirm relink';
      calGuardRelinkBtn.disabled = false;
      calGuardRelinkBtn.title = 'Replace the target saved curve and apply it to this input';
      calGuardUseBtn.classList.add('hidden');
      calGuardDismissBtn.textContent = 'Cancel';
      calGuardDismissBtn.title = 'Cancel relinking';
    } else {
      const reopen = info.reason === 'no-id';
      calGuardTextEl.textContent = info.message;
      calGuardRelinkBtn.textContent = reopen ? 'Reopen input' : 'Relink';
      calGuardRelinkBtn.disabled = reopen ? !info.canReopen : !info.canRelink;
      calGuardRelinkBtn.title = reopen
        ? (info.canReopen ? 'Reopen the input and refresh its device ID' : 'Microphone access is unavailable')
        : info.canRelink
          ? 'Preview and confirm copying the active calibration to the current input'
          : 'This mono input cannot apply a right-channel curve';
      calGuardUseBtn.classList.remove('hidden');
      calGuardUseBtn.disabled = !info.hasSaved;
      calGuardUseBtn.title = 'Open saved curves and choose one for this input';
      calGuardDismissBtn.textContent = 'Continue';
      calGuardDismissBtn.title = 'Continue measuring without calibration for this input and mode';
    }
    calGuardEl.dataset.reason = info.reason;
    calGuardEl.classList.remove('hidden');
    calGuardEl.setAttribute('aria-hidden', 'false');
  }

  function openCalibrationSettings() {
    if (S.uiMode !== 'advanced') {
      setSetting('uiMode', 'advanced');
      dismissUiTip();
    }
    const tab = $('.seg[data-seg="tab"] .segBtn[data-tab="input"]');
    if (tab) tab.click();
    openSheet(sheet);
    const list = $('#micCalibrationSaved');
    if (list) {
      setTimeout(() => {
        try { list.focus(); list.scrollIntoView({ block: 'center' }); } catch (e) {}
      }, 0);
    }
  }

  function reopenInputForCalibration() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('This browser cannot reopen the input');
      return;
    }
    if (running && !demoOn && audio.ctx) restartInput();
    else startMic();
  }

  function relinkActiveCalibration(info) {
    const targetId = calibrationDeviceId();
    if (!info || !info.canRelink || !targetId || !info.sourceEntries.length) {
      toast('Calibration cannot be relinked to this input');
      return false;
    }
    const previousMode = S.chanMode;
    const previousLastActiveKey = lastActiveCalibrationKey;
    const updates = [];
    for (const source of info.sourceEntries) {
      const targetKey = calibrationKey(targetId, source.channel);
      if (!targetKey) continue;
      updates.push({
        targetKey,
        previousSaved: micCalibrations[targetKey],
        previousActive: activeMicCalibrations[targetKey],
        source
      });
    }
    if (!updates.length) {
      toast('Calibration cannot be relinked to this input');
      return false;
    }
    for (const update of updates) {
      update.installedEntry = {
        name: update.source.entry.name,
        points: update.source.entry.points.map((point) => [point[0], point[1]]),
        label: currentDeviceLabel() || (update.source.entry && update.source.entry.label) || 'Selected input'
      };
      micCalibrations[update.targetKey] = update.installedEntry;
      activeMicCalibrations[update.targetKey] = update.installedEntry;
    }
    if (!saveMicCalibrations()) {
      for (const update of updates) {
        if (update.previousSaved) micCalibrations[update.targetKey] = update.previousSaved;
        else delete micCalibrations[update.targetKey];
        if (update.previousActive) activeMicCalibrations[update.targetKey] = update.previousActive;
        else delete activeMicCalibrations[update.targetKey];
      }
      micCalibrationError = 'Could not relink calibration: device storage is full. Remove another calibration or free storage and try again.';
      syncMicCalibration(micCalibrationError);
      return false;
    }

    micCalibrationBypassed = false;
    micCalibrationError = '';
    for (const update of updates) rememberActiveCalibration(update.targetKey);
    if (info.relinkMode && info.relinkMode !== S.chanMode) setSetting('chanMode', info.relinkMode);
    const undo = {
      targetId,
      previousMode,
      modeAfter: S.chanMode,
      previousLastActiveKey,
      updates
    };
    micCalibrationChannel.value = info.sourceEntries[0].channel;
    renderMicCalibrationList();
    const list = $('#micCalibrationSaved');
    if (list) list.value = updates[0].targetKey;
    calibrationGuardDismissed = '';
    calibrationGuardPreview = null;
    syncMicCalibration();
    resetAvg();
    toast('Calibration relinked to ' + (currentDeviceLabel() || 'this input') +
      ' · ' + calibrationChannelPhrase(info.sourceEntries.map((item) => item.channel)), {
      label: 'Undo',
      run: () => undoRelink(undo)
    });
    return true;
  }

  function undoRelink(undo) {
    if (!undo) return;
    if (calibrationDeviceId() !== undo.targetId) {
      toast('Cannot undo relink after changing input');
      return;
    }
    if (undo.updates.some((update) =>
      activeMicCalibrations[update.targetKey] !== update.installedEntry ||
      micCalibrations[update.targetKey] !== update.installedEntry)) {
      toast('Cannot undo relink after the calibration changed');
      return;
    }
    for (const update of undo.updates) {
      if (update.previousSaved) micCalibrations[update.targetKey] = update.previousSaved;
      else delete micCalibrations[update.targetKey];
      if (update.previousActive) activeMicCalibrations[update.targetKey] = update.previousActive;
      else delete activeMicCalibrations[update.targetKey];
    }
    if (!saveMicCalibrations()) {
      for (const update of undo.updates) {
        micCalibrations[update.targetKey] = update.installedEntry;
        activeMicCalibrations[update.targetKey] = update.installedEntry;
      }
      micCalibrationError = 'Could not undo relink: device storage is full.';
      syncMicCalibration(micCalibrationError);
      return;
    }
    if (undo.modeAfter !== undo.previousMode && S.chanMode === undo.modeAfter) {
      setSetting('chanMode', undo.previousMode);
    }
    lastActiveCalibrationKey = undo.previousLastActiveKey;
    calibrationGuardPreview = null;
    calibrationGuardDismissed = '';
    micCalibrationError = '';
    renderMicCalibrationList();
    syncMicCalibration();
    resetAvg();
    toast('Relink undone');
  }

  function parseMicCalibration(text) {
    const sourceLines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
    const records = [];
    let delimiter = null;
    const numericCell = (value) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value);
    const parseNumber = (value) => {
      const normalized = delimiter === ';' ? value.replace(',', '.') : value;
      return numericCell(normalized) ? Number(normalized) : NaN;
    };
    for (const line of sourceLines) {
      const trimmed = line.trim();
      if (!trimmed || /^[#*!]/.test(trimmed) || (trimmed[0] === ';' && (trimmed.length === 1 || /\s/.test(trimmed[1])))) continue;
      const hasDecimalComma = delimiter === ';' && /^[+-]?\d+,\d+(?:e[+-]?\d+)?(?:;|$)/i.test(trimmed);
      const rowDelimiter = hasDecimalComma ? ';' : trimmed.includes('\t') ? '\t' : trimmed.includes(';') ? ';' : trimmed.includes(',') ? ',' : null;
      if (delimiter && rowDelimiter && delimiter !== rowDelimiter) {
        const decimalCommaRow = delimiter === ';' && rowDelimiter === ',' && /^[+-]?\d+,\d+(?:e[+-]?\d+)?(?:;|$)/i.test(trimmed);
        if (!decimalCommaRow) throw new Error('Mixed column separators; save the file with one delimiter.');
      }
      let cells;
      if (rowDelimiter) {
        cells = [];
        let cell = '', quoted = false;
        for (let i = 0; i < trimmed.length; i++) {
          const ch = trimmed[i];
          if (ch === '"') {
            if (quoted && trimmed[i + 1] === '"') { cell += '"'; i++; }
            else quoted = !quoted;
          } else if (ch === rowDelimiter && !quoted) {
            cells.push(cell.trim()); cell = '';
          } else cell += ch;
        }
        if (quoted) throw new Error('Unclosed quoted field.');
        cells.push(cell.trim());
      } else {
        if (trimmed.includes('"')) throw new Error('Quoted fields require a comma, semicolon or tab delimiter.');
        cells = trimmed.split(/\s+/);
      }
      if (rowDelimiter) delimiter = rowDelimiter;
      records.push({ cells, original: trimmed });
    }
    if (!records.length) throw new Error('File contains no readable rows.');

    const normalize = (s) => s.toLowerCase().replace(/[ _-]+/g, '').replace(/[()\[\]]/g, '');
    const freqName = (s) => /^(?:freq|frequency|frequencyhz|freqhz|hz)$/.test(normalize(s));
    const responseName = (s) => {
      const n = normalize(s);
      const hasDbUnit = /(?:dbfs|db)$/.test(n);
      return hasDbUnit && /(?:response|magnitude|level|spl|correction|calibration|sensitivity|^db)/.test(n);
    };
    const first = records[0];
    let freqIndex = -1, responseIndex = -1, dataStart = 0;
    if (first.cells.some((c) => freqName(c)) || first.cells.some((c) => responseName(c))) {
      const freqs = [], responses = [];
      first.cells.forEach((c, i) => { if (freqName(c)) freqs.push(i); if (responseName(c)) responses.push(i); });
      if (freqs.length !== 1 || responses.length !== 1 || freqs[0] === responses[0]) {
        throw new Error('Header is ambiguous. It must identify exactly one frequency (Hz) column and one response (dB) column.');
      }
      freqIndex = freqs[0]; responseIndex = responses[0]; dataStart = 1;
    } else {
      const cells = first.cells;
      if (!numericCell(cells[0]) && cells.length >= 2) {
        throw new Error('Unrecognized header. Name columns Frequency (Hz) and Response (dB), or use two numeric columns: frequency, response dB.');
      }
      if (cells.length === 2) {
        freqIndex = 0; responseIndex = 1;
      } else {
        throw new Error('Ambiguous columns. Use two numeric columns (frequency Hz, response dB) or a header that names those columns and response units; extra columns require an explicit header.');
      }
    }

    const points = [];
    for (let row = dataStart; row < records.length; row++) {
      const { cells, original } = records[row];
      if (cells.length !== records[0].cells.length) {
        throw new Error('Inconsistent column count on row: ' + original.slice(0, 48));
      }
      if (cells.length <= Math.max(freqIndex, responseIndex)) {
        throw new Error('Row has too few columns: ' + original.slice(0, 48));
      }
      const freq = parseNumber(cells[freqIndex]);
      const response = parseNumber(cells[responseIndex]);
      if (!Number.isFinite(freq) || !Number.isFinite(response)) {
        throw new Error('Could not read the selected frequency and response columns in row: ' + original.slice(0, 48));
      }
      if (freq <= 0 || freq > 200000 || response < -100 || response > 100) {
        throw new Error('Frequency must be 0–200 kHz and response must be −100 to +100 dB.');
      }
      points.push([freq, response]);
    }
    points.sort((a, b) => a[0] - b[0]);
    if (points.length < 2) throw new Error('No calibration data found. Use at least two frequency,response-dB rows.');
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] === points[i - 1][0]) throw new Error('Duplicate frequency ' + points[i][0] + ' Hz.');
    }
    return points;
  }

  function micCalibrationAt(freq, points) {
    if (!points || points.length < 2 || freq < points[0][0] || freq > points[points.length - 1][0]) return 0;
    let hi = 1;
    while (hi < points.length && points[hi][0] < freq) hi++;
    const a = points[hi - 1], b = points[hi];
    const t = (Math.log(freq) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
    return a[1] + (b[1] - a[1]) * t;
  }
  function correctMicLevel(level, freq, points) {
    return level - micCalibrationAt(freq, points);
  }
  if (new URLSearchParams(location.search).has('micCalibrationTest')) {
    window.__micCalibrationTest = { parse: parseMicCalibration, at: micCalibrationAt, correct: correctMicLevel, calibration: micCalibrationFor, appliedCalibration: (deviceId, channel) => micCalibrationBypassed ? null : micCalibrationFor(deviceId, channel), captureChannel: captureChannelForSlot, deviceId: calibrationDeviceId, guard: calibrationGuardInfo, activeCalibrations: () => Object.keys(activeMicCalibrations) };
  }

  function saveMicCalibrations() {
    try {
      const size = new Blob([JSON.stringify(micCalibrations)]).size;
      if (size > 4 * 1024 * 1024) throw new Error('Calibration storage limit exceeded');
      localStorage.setItem(MIC_CAL_KEY, JSON.stringify(micCalibrations));
      return true;
    } catch (e) {
      return false;
    }
  }

  const micCalibrationChannel = $('#micCalibrationChannel');
  micCalibrationChannel.value = 'L';
  micCalibrationChannel.addEventListener('change', () => {
    micCalibrationError = '';
    renderMicCalibrationList();
    syncMicCalibration();
  });

  const micCalibrationApply = $('#micCalibrationApply');
  if (micCalibrationApply) micCalibrationApply.addEventListener('change', () => {
    micCalibrationBypassed = !micCalibrationApply.checked;
    resetAvg();
    syncMicCalibration();
    toast(micCalibrationBypassed ? 'Microphone calibration bypassed' : 'Microphone calibration applied');
  });

  const micCalibrationFile = $('#micCalibrationFile');
  micCalibrationFile.addEventListener('change', async () => {
    const file = micCalibrationFile.files && micCalibrationFile.files[0];
    micCalibrationFile.value = '';
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('File is larger than 2 MiB.');
      const points = parseMicCalibration(await file.text());
      const key = calibrationKey(calibrationDeviceId(), micCalibrationChannel.value);
      if (!key) throw new Error('Select an input device that reports an ID before loading a calibration.');
      const previous = micCalibrations[key];
      const previousActive = activeMicCalibrations[key];
      const wasBypassed = micCalibrationBypassed;
      micCalibrations[key] = { name: file.name, points, label: currentDeviceLabel() || (previous && previous.label) || 'Selected input' };
      activeMicCalibrations[key] = micCalibrations[key];
      micCalibrationBypassed = false;
      if (!saveMicCalibrations()) {
        if (previous) micCalibrations[key] = previous;
        else delete micCalibrations[key];
        if (previousActive) activeMicCalibrations[key] = previousActive;
        else delete activeMicCalibrations[key];
        micCalibrationBypassed = wasBypassed;
        micCalibrationError = 'Could not save calibration: device storage is full. Remove another calibration or free storage and try again.';
        syncMicCalibration(micCalibrationError);
        return;
      }
      micCalibrationError = '';
      rememberActiveCalibration(key);
      renderMicCalibrationList();
      const savedList = $('#micCalibrationSaved');
      if (savedList) savedList.value = key;
      syncMicCalibration();
      resetAvg();
      toast('Microphone calibration loaded for this channel');
    } catch (err) {
      micCalibrationError = 'Calibration not loaded: ' + err.message;
      syncMicCalibration(micCalibrationError);
    }
  });

  $('#btnUseMicCalibration').addEventListener('click', () => {
    const list = $('#micCalibrationSaved');
    const sourceKey = list && list.value;
    const source = sourceKey && micCalibrations[sourceKey];
    const channel = normalizeCalibrationChannel(micCalibrationChannel.value);
    const targetKey = calibrationKey(calibrationDeviceId(), channel);
    if (!source) {
      micCalibrationError = 'Choose a saved calibration first.';
      syncMicCalibration(micCalibrationError);
      return;
    }
    if (!targetKey) {
      micCalibrationError = 'Select an input device that reports an ID before using a calibration.';
      syncMicCalibration(micCalibrationError);
      return;
    }
    const previous = micCalibrations[targetKey];
    const previousActive = activeMicCalibrations[targetKey];
    const wasBypassed = micCalibrationBypassed;
    micCalibrations[targetKey] = {
      name: source.name,
      points: source.points.map((point) => [point[0], point[1]]),
      label: currentDeviceLabel() || (previous && previous.label) || 'Selected input'
    };
    activeMicCalibrations[targetKey] = micCalibrations[targetKey];
    micCalibrationBypassed = false;
    if (!saveMicCalibrations()) {
      if (previous) micCalibrations[targetKey] = previous;
      else delete micCalibrations[targetKey];
      if (previousActive) activeMicCalibrations[targetKey] = previousActive;
      else delete activeMicCalibrations[targetKey];
      micCalibrationBypassed = wasBypassed;
      micCalibrationError = 'Could not save calibration: device storage is full. Remove another calibration or free storage and try again.';
      syncMicCalibration(micCalibrationError);
      return;
    }
    micCalibrationError = '';
    rememberActiveCalibration(targetKey);
    renderMicCalibrationList();
    if (list) list.value = targetKey;
    syncMicCalibration();
    resetAvg();
    toast('Calibration assigned to ' + (currentDeviceLabel() || 'this input') +
      ' · ' + calibrationChannelLabel(channel) + ' channel');
  });

  $('#btnRemoveMicCalibration').addEventListener('click', () => {
    const list = $('#micCalibrationSaved');
    const key = list && list.value;
    if (!key || !micCalibrations[key]) return;
    const previous = micCalibrations[key];
    const previousActive = activeMicCalibrations[key];
    const removedLabel = savedCalibrationLabel(key.slice(0, -2), previous) +
      ' · ' + calibrationChannelLabel(key.slice(-1)) + ' channel';
    delete micCalibrations[key];
    delete activeMicCalibrations[key];
    if (!saveMicCalibrations()) {
      micCalibrations[key] = previous;
      if (previousActive) activeMicCalibrations[key] = previousActive;
      micCalibrationError = 'Could not remove calibration from device storage.';
      syncMicCalibration(micCalibrationError);
      return;
    }
    micCalibrationError = '';
    forgetActiveCalibration(key);
    renderMicCalibrationList();
    syncMicCalibration();
    resetAvg();
    toast('Removed ' + removedLabel);
  });

  calGuardRelinkBtn.addEventListener('click', () => {
    const info = calibrationGuardInfo();
    if (!info) return;
    if (info.reason === 'no-id') {
      reopenInputForCalibration();
      return;
    }
    if (calibrationGuardPreview) {
      if (calibrationGuardPreview.signature !== info.signature) {
        calibrationGuardPreview = null;
        syncCalibrationGuard();
        return;
      }
      calibrationGuardPreview = null;
      relinkActiveCalibration(info);
      return;
    }
    calibrationGuardPreview = { signature: info.signature, message: relinkPreviewMessage(info) };
    syncCalibrationGuard();
  });

  calGuardUseBtn.addEventListener('click', openCalibrationSettings);

  calGuardDismissBtn.addEventListener('click', () => {
    if (calibrationGuardPreview) {
      calibrationGuardPreview = null;
      syncCalibrationGuard();
      toast('Relink cancelled');
      return;
    }
    const info = calibrationGuardInfo();
    if (!info) return;
    calibrationGuardDismissed = info.signature;
    syncCalibrationGuard();
    toast('Continuing without calibration');
  });

  $('#btnRefreshInputs').addEventListener('click', async () => {
    await populateInputs();
    toast('Input list refreshed');
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      populateInputs();
      syncMicCalibration();
    });
  }

  $('#btnDemo').addEventListener('click', () => {
    demoOn = true;
    running = true;
    gate.classList.add('hidden');
    applyPaused(false);
    syncMicCalibration();
    updateInfo();
    toast('Demo signal — no microphone in use');
  });

  /* ---------------- input self-test ----------------
     Answers the two things a tablet cannot answer for you: how many channels
     the browser really delivered, and whether there is signal on both. It reads
     left and right straight off the stream (through its own splitter), so the
     result is the hardware, not whatever channel mode the app happens to be in. */
  const stEl = $('#selftest');
  const stState = {
    ctx: null, own: false, stream: null, src: null, splitter: null,
    nodes: [], buf: null, timer: 0, hold: [-Infinity, -Infinity], chans: 1, gen: 0
  };

  function stRow(k, v) {
    return '<div class="stRow"><span class="stK">' + k + '</span><span class="stV">' + esc(v) + '</span></div>';
  }

  function stDb(p) { return p > 0 ? 20 * Math.log10(p) : -Infinity; }
  function stFmt(db) { return isFinite(db) ? db.toFixed(1) + ' dBFS' : '—'; }

  async function stPermission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'not exposed';
      const p = await navigator.permissions.query({ name: 'microphone' });
      return p.state;
    } catch (e) { return 'not exposed'; }
  }

  function stStop() {
    anStop();
    clearInterval(stState.timer);
    stState.timer = 0;
    /* any run still waiting on the permission prompt is now stale */
    stState.gen++;
    stState.chans = 1;
    [stState.src, stState.splitter].forEach((n) => {
      if (n) { try { n.disconnect(); } catch (e) {} }
    });
    stState.src = null;
    stState.splitter = null;
    stState.nodes.forEach((n) => { try { n.disconnect(); } catch (e) {} });
    stState.nodes = [];
    if (stState.own) {
      if (stState.stream) stState.stream.getTracks().forEach((t) => t.stop());
      if (stState.ctx) { try { stState.ctx.close(); } catch (e) {} }
    }
    stState.stream = null;
    stState.ctx = null;
    stState.own = false;
    stState.buf = null;
  }

  function stVerdict(chans, peaks) {
    const p1 = peaks[0], p2 = peaks[1];
    const has1 = isFinite(p1) && p1 > -75;
    const has2 = chans >= 2 ? (isFinite(p2) && p2 > -75) : has1;
    if (chans < 2) {
      return { bad: false, text: 'Mono input delivered (' + chans + ' channel). 1+2 will show the same signal on both inputs — that is what the browser and device provide, not a setting.' };
    }
    if (!has1) {
      return { bad: true, text: 'No signal on input 1 yet. Check the input is connected and the OS input level is up, then talk or clap.' };
    }
    if (!has2) {
      return { bad: true, text: 'Input 2 is silent while input 1 has signal. A stereo interface should give both — check the second cable or feed, then select 1+2 in Settings → Input.' };
    }
    if (Math.abs(p1 - p2) < 1) {
      return { bad: false, text: 'Both channels carry signal at almost the same level. That is normal for a duplicated feed, and also what a mono input reported as stereo looks like.' };
    }
    return { bad: false, text: 'Stereo confirmed: input 1 and input 2 carry signal ' + Math.abs(p1 - p2).toFixed(1) + ' dB apart. 1+2 will measure them separately.' };
  }

  function stPaint() {
    const n = stState.nodes.length;
    if (!n) return;
    const bars = [$('#stBar1'), $('#stBar2')];
    const vals = [$('#stVal1'), $('#stVal2')];
    for (let k = 0; k < 2; k++) {
      /* a mono input exposes one node twice: both rows then show that channel */
      const node = stState.nodes[Math.min(k, n - 1)];
      node.getFloatTimeDomainData(stState.buf);
      let p = 0;
      for (let i = 0; i < stState.buf.length; i++) {
        const v = Math.abs(stState.buf[i]);
        if (v > p) p = v;
      }
      const db = stDb(p);
      if (db > stState.hold[k]) stState.hold[k] = db;
      if (bars[k]) bars[k].style.width = clamp((db + 60) / 60, 0, 1) * 100 + '%';
      if (vals[k]) vals[k].textContent = stFmt(stState.hold[k]);
    }
    const v = stVerdict(stState.chans || 1, stState.hold);
    const el = $('#stVerdict');
    if (el && el.textContent !== v.text) {
      el.textContent = v.text;
      el.classList.toggle('bad', v.bad);
    }
  }

  async function runSelfTest() {
    stStop();
    const gen = stState.gen;
    stState.hold = [-Infinity, -Infinity];
    const rows = $('#stRows'), msg = $('#stMsg'), verdict = $('#stVerdict');
    if (rows) rows.innerHTML = '';
    if (msg) { msg.textContent = ''; msg.className = 'gateMsg'; }
    if (verdict) { verdict.textContent = 'Opening the input…'; verdict.classList.remove('bad'); }
    ['stBar1', 'stBar2'].forEach((id) => { const b = $('#' + id); if (b) b.style.width = '0%'; });
    ['stVal1', 'stVal2'].forEach((id) => { const v = $('#' + id); if (v) v.textContent = '—'; });

    let ctx = null, stream = null, own = false;
    try {
      /* reading the live stream avoids a second getUserMedia on Android, where
         the app already holds the device */
      if (running && !demoOn && audio.stream && audio.ctx && !stState.forceOwn) {
        ctx = audio.ctx;
        stream = audio.stream;
      } else {
        ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        await ctx.resume();
        own = true;
        stream = await openMicStream();
      }
      /* closed or re-run while the permission prompt was up: drop the stream
         instead of leaving the microphone open behind a hidden panel */
      if (gen !== stState.gen) {
        if (own) {
          stream.getTracks().forEach((t) => t.stop());
          try { ctx.close(); } catch (e) {}
        }
        return;
      }

      const track = stream.getAudioTracks()[0];
      const set = (track && track.getSettings) ? track.getSettings() : {};
      const chans = (set.channelCount || audio.chans || 1) || 1;

      const src = ctx.createMediaStreamSource(stream);
      const nodes = [];
      let splitter = null;
      if (chans >= 2) {
        splitter = ctx.createChannelSplitter(2);
        src.connect(splitter);
        for (let i = 0; i < 2; i++) {
          const an = ctx.createAnalyser();
          an.fftSize = 4096;
          an.smoothingTimeConstant = 0;
          splitter.connect(an, i);
          nodes.push(an);
        }
      } else {
        const an = ctx.createAnalyser();
        an.fftSize = 4096;
        an.smoothingTimeConstant = 0;
        src.connect(an);
        nodes.push(an, an);
      }

      stState.ctx = ctx;
      stState.stream = stream;
      stState.own = own;
      stState.src = src;
      stState.splitter = splitter;
      stState.nodes = nodes;
      stState.chans = chans;
      stState.buf = new Float32Array(nodes[0].fftSize);

      /* a stream that opened proves permission, even when the query is stale */
      let perm = await stPermission();
      if (perm !== 'granted') perm = 'granted (stream opened)';
      const rate = set.sampleRate || ctx.sampleRate;
      const flag = (v) => (v === undefined ? 'unknown' : (v ? 'on' : 'off'));
      if (rows) {
        rows.innerHTML =
          stRow('Secure context', window.isSecureContext ? 'yes' : 'NO — microphone needs HTTPS') +
          stRow('Microphone permission', perm) +
          stRow('Input device', track && track.label ? track.label : 'unnamed input') +
          stRow('Channels requested', S.chanMode === 'mix' ? 'default' : '2 (stereo)') +
          stRow('Channels delivered', String(chans)) +
          stRow('Sample rate', Math.round(rate) + ' Hz') +
          stRow('Analyzer FFT', S.fft + ' (' + (rate / S.fft).toFixed(1) + ' Hz per bin)') +
          stRow('App channel mode', S.chanMode === 'dual' ? '1+2 (L / R split)' : S.chanMode) +
          stRow('Input 2 source', chans >= 2 ? 'right channel of the interface' : 'same signal as input 1') +
          stRow('Echo cancellation', flag(set.echoCancellation)) +
          stRow('Noise suppression', flag(set.noiseSuppression)) +
          stRow('Auto gain control', flag(set.autoGainControl)) +
          stRow('Stream', own ? 'temporary test stream (closed on exit)' : 'live measurement stream');
      }
      if (gen !== stState.gen) return;
      stState.timer = setInterval(stPaint, 50);
      stPaint();
    } catch (err) {
      if (gen !== stState.gen) return;
      /* a second source off a live stream is refused by some browsers: retry
         with a temporary stream rather than reporting a hardware failure */
      if (!own && !stState.forceOwn) {
        stState.forceOwn = true;
        await runSelfTest();
        return;
      }
      stStop();
      if (msg) { msg.textContent = micErrorText(err); msg.className = 'gateMsg'; }
      if (verdict) verdict.textContent = '';
      if (rows) {
        rows.innerHTML = stRow('Secure context', window.isSecureContext ? 'yes' : 'no') +
          stRow('Channels requested', S.chanMode === 'mix' ? 'default' : '2 (stereo)');
      }
    }
  }

  /* ---------------- analyzer accuracy test ----------------
     Tones are generated inside the page, so this needs no microphone, no
     permission and no hardware, and the expected values are exact. Each tone
     runs through a real AnalyserNode, then through the same bin mapping,
     calibration and peak rule as the live RTA (the peak readout labels the
     band with the most energy, not a raw FFT bin). */
  const anTest = { ctx: null, osc: null, mute: null, gen: 0 };

  function anStop() {
    anTest.gen++;
    if (anTest.osc) { try { anTest.osc.stop(); } catch (e) {} }
    anTest.osc = null;
    if (anTest.ctx) {
      try {
        const p = anTest.ctx.close();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
    anTest.ctx = null;
    anTest.mute = null;
    const b = $('#stRunAnalyzer');
    if (b) { b.disabled = false; b.textContent = 'Run analyzer test'; }
  }

  function nearestBand(list, f) {
    let bi = 0, best = 1e9;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(Math.log2(list[i].fc / f));
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }

  async function runAnalyzerTest() {
    anStop();
    const gen = anTest.gen;
    const rows = $('#stAnRows'), verdict = $('#stAnVerdict'), btn = $('#stRunAnalyzer');
    if (!rows || !verdict) return;
    rows.innerHTML = '';
    verdict.classList.remove('bad');
    verdict.textContent = 'Generating reference tones…';
    if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }

    try {
      let ctx;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: audio.ctx ? audio.ctx.sampleRate : 48000,
          latencyHint: 'interactive'
        });
      } catch (e) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      anTest.ctx = ctx;
      await ctx.resume();
      if (gen !== anTest.gen) return;

      /* Test the bands the user is actually looking at, mapped to this
         context's sample rate, so the check covers the current display scale. */
      const list = bands.map((b) => ({ fc: b.fc, lg: b.lg, lo: b.lo, hi: b.hi, k0: 0, k1: 0 }));
      mapBins(list, ctx.sampleRate, S.fft);
      const an = ctx.createAnalyser();
      an.fftSize = S.fft;
      an.smoothingTimeConstant = 0;
      const osc = ctx.createOscillator();
      const tone = ctx.createGain();
      const mute = ctx.createGain();
      /* tone -> analyser -> muted output: the graph is pulled, but silent */
      tone.gain.value = 0;
      mute.gain.value = 0;
      osc.connect(tone);
      tone.connect(an);
      an.connect(mute);
      mute.connect(ctx.destination);
      osc.start();
      anTest.osc = osc;
      anTest.mute = mute;

      const bins = new Float32Array(an.frequencyBinCount);
      const tmp = new Float32Array(list.length);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      /* the analyser window is fft/sampleRate long: reading sooner mixes the
         previous tone into the FFT and would under-read the level */
      const settle = Math.ceil((S.fft / ctx.sampleRate) * 1000) + 160;
      const read = async () => {
        await wait(settle);
        an.getFloatFrequencyData(bins);
        levelsFor(list, bins, tmp);
        let bi = 0, best = -1e9;
        for (let i = 0; i < tmp.length; i++) if (tmp[i] > best) { best = tmp[i]; bi = i; }
        return { bi: bi, level: best };
      };

      const cases = [
        { f: 125, amp: 0.5, exp: -6.0 },
        { f: 1000, amp: 0.1, exp: -20.0 },
        { f: 4000, amp: 0.1, exp: -20.0 }
      ];
      const tol = 1.0;
      const fails = [];
      const banding = S.banding === 1 ? '1 octave' : '1/' + S.banding + ' octave';
      rows.innerHTML =
        stRow('Banding / FFT', banding + ' · ' + S.fft) +
        stRow('Test sample rate', Math.round(ctx.sampleRate) + ' Hz') +
        stRow('Level tolerance', '±' + tol + ' dB');

      for (const c of cases) {
        const want = nearestBand(list, c.f);
        osc.frequency.setValueAtTime(c.f, ctx.currentTime);
        tone.gain.cancelScheduledValues(ctx.currentTime);
        tone.gain.setValueAtTime(0, ctx.currentTime);
        await wait(80);
        tone.gain.setValueAtTime(c.amp, ctx.currentTime);
        const got = await read();
        if (gen !== anTest.gen) return;

        const peak = list[got.bi] ? list[got.bi].fc : 0;
        const lvlOk = Math.abs(got.level - c.exp) <= tol;
        const peakOk = got.bi === want && peak > 0 && Math.abs(peak - c.f) / c.f < 0.02;
        if (!lvlOk) fails.push(c.f + ' Hz level ' + got.level.toFixed(1) + ' dB');
        if (!peakOk) fails.push(c.f + ' Hz peak ' + fmtHzCursor(peak));
        rows.innerHTML +=
          stRow(c.f + ' Hz @ ' + (c.amp === 0.5 ? '-6' : '-20') + ' dBFS',
            got.level.toFixed(1) + ' dB' + (lvlOk ? ' ✓' : ' ✗ expected ' + c.exp.toFixed(1))) +
          stRow('Peak at ' + c.f + ' Hz',
            (peakOk ? fmtHzCursor(peak) + ' ✓' : fmtHzCursor(peak) + ' ✗ expected ' + fmtHzCursor(c.f)));
      }

      verdict.textContent = fails.length
        ? 'Analyzer test failed: ' + fails.join('; ') + '. Check Display → RTA scale and FFT, then run it again.'
        : 'Analyzer verified: levels within ±' + tol + ' dB and the peak lands on the expected band. ' +
          '0 dBFS is a full-scale sine; the microphone is not part of this test.';
      verdict.classList.toggle('bad', fails.length > 0);
    } catch (err) {
      verdict.textContent = 'The analyzer test could not run: ' + ((err && err.message) || err);
      verdict.classList.add('bad');
    } finally {
      if (gen === anTest.gen) anStop();
    }
  }

  function openSelfTest() {
    closeSheets();
    stState.forceOwn = false;
    stEl.classList.remove('hidden');
    stEl.setAttribute('aria-hidden', 'false');
    const closeBtn = $('#stClose');
    if (closeBtn) closeBtn.focus();
    runSelfTest();
  }

  function closeSelfTest() {
    stStop();
    stEl.classList.add('hidden');
    stEl.setAttribute('aria-hidden', 'true');
  }

  $('#btnSelfTest').addEventListener('click', openSelfTest);
  $('#btnSelfTest2').addEventListener('click', openSelfTest);
  $('#stClose').addEventListener('click', closeSelfTest);
  $('#stRun').addEventListener('click', runSelfTest);
  const stAnBtn = $('#stRunAnalyzer');
  if (stAnBtn) stAnBtn.addEventListener('click', runAnalyzerTest);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !stEl.classList.contains('hidden')) closeSelfTest();
  });

  /* ---------------- main loop ---------------- */
  let lastAnalysis = 0;
  let lastDraw = 0;
  let lastT = 0;

  /* Trim is applied once, per channel, so a live microphone and the demo
     signal are levelled the same way; bandLevels returns measured level only. */
  function applyTrimInPlace(key, raw) {
    const trim = key === 'b' ? S.trimB : S.trim;
    if (trim) for (let i = 0; i < raw.length; i++) raw[i] += trim;
    return raw;
  }

  function applyMicCalibrationInPlace(key, raw) {
    if (micCalibrationBypassed) return raw;
    const calibration = micCalibrationFor(calibrationDeviceId(), captureChannelForSlot(key));
    if (!calibration || !calibration.points) return raw;
    for (let i = 0; i < raw.length; i++) {
      raw[i] = correctMicLevel(raw[i], bands[i].fc, calibration.points);
    }
    return raw;
  }

  function analyzeChannel(key, dt) {
    const ch = CH[key];
    const an = key === 'a' ? audio.a1 : audio.a2;
    if (!an || !ch.freq || !ch.raw.length) return;
    an.getFloatFrequencyData(ch.freq);
    const raw = applyTrimInPlace(key, applyMicCalibrationInPlace(key, bandLevels(ch.freq, ch.raw)));
    averageInto(ch.avg, raw, dt);
    updatePeakHold(ch);
  }

  function analyzeDemoChannel(key, dt) {
    const ch = CH[key];
    if (!ch.raw.length) return;
    const raw = applyTrimInPlace(key, demoLevels(ch.raw, key));
    averageInto(ch.avg, raw, dt);
    updatePeakHold(ch);
  }

  function analyze(dt) {
    const dual = isDual();
    if (demoOn) {
      analyzeDemoChannel('a', dt);
      if (dual) analyzeDemoChannel('b', dt);
    } else if (audio.a1) {
      analyzeChannel('a', dt);
      if (dual) analyzeChannel('b', dt);
    }
    const data = rtaChan().avg.data;
    if (!data) return;
    settleUpdate(data);
    avgAccumulate();
    const sp = specChan().avg.data;
    if (sp) specPush(sp, dt);

    /* readouts follow the input the RTA is set to */
    let bi = 0, best = -1e9;
    for (let i = 0; i < data.length; i++) if (data[i] > best) { best = data[i]; bi = i; }
    roLevel.textContent = fmtDb(best);
    roPeak.textContent = S.trackPeak && bands[bi] ? fmtHzCursor(bands[bi].fc) : '—';
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = lastT ? Math.min(0.25, (t - lastT) / 1000) : 1 / 60;
    lastT = t;

    if (running && !S.paused && t - lastAnalysis >= 30) {
      /* the analysis interval, not the frame interval, is what the
         averaging time constants and the spectrograph clock must use */
      const adt = lastAnalysis ? (t - lastAnalysis) / 1000 : 1 / 30;
      lastAnalysis = t;
      analyze(adt);
    }
    if (t - lastDraw >= 30) {
      lastDraw = t;
      drawRTA();
      drawSpec();
      updateInfo();
      updateMeters(t);
    }
  }

  /* ---------------- boot ---------------- */
  applyTheme();
  rebuildBands();
  renderMicCalibrationList();
  applyStoredTrim();
  renderSetups();
  syncChips();
  const avgSecsSaved = localStorage.getItem('rtapro.avgsecs.v1');
  if (avgSecsSaved && $('#avgSecs')) $('#avgSecs').value = avgSecsSaved;
  renderTraces();
  updateUndoBtn();
  bindSettings();
  applyUiMode();
  setFocus('both');
  updateState();
  updateInfo();
  if ($('#aboutBuild')) {
    $('#aboutBuild').textContent = 'Build ' + new Date().toISOString().slice(0, 10) +
      ' · two inputs (1+2 overlay) · relative levels (dBFS) only · no SPL metering';
  }

  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') {
    demoOn = true;
    running = true;
    gate.classList.add('hidden');
    applyPaused(false);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  requestAnimationFrame(loop);
})();
