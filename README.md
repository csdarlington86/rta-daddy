# RTA Daddy — two-input real-time analyzer

A browser-based real-time analyzer built as a close functional clone of the **Pro** tier of
Smaart RTA, **minus SPL metering**, made to run full-screen on Android tablets.

It is an independent implementation: no Rational Acoustics code, assets or algorithms were used,
and it is not affiliated with or endorsed by them. The feature set was matched from their
published comparison table, FAQ and support articles, and the layout from their screenshots.

Live app: https://rtadaddy.freebuff.page

## Source and downloads

- Repository: https://github.com/csdarlington86/rta-daddy
- Download ZIP: https://github.com/csdarlington86/rta-daddy/archive/refs/heads/master.zip
- Clone: `git clone https://github.com/csdarlington86/rta-daddy.git`

The GitHub repository is the public source and backup. The live app is built into
`deploy/dist` and published separately through Freebuff Sites (Cloudflare Workers);
pushing to GitHub does not deploy it by itself.

---

## Feature set

**Base tier**

- **RTA plot** — fractional-octave real-time spectrum, 20 Hz – 20 kHz
- **Spectrograph** — frequency along the bottom (same axis as the RTA), time running
  top-to-bottom so new slices enter at the **bottom and scroll upward**; 250/500/1000 slices of
  history, adjustable dynamic range, and **rewind** when paused
- **Plot zoom + scrolling** — pinch to zoom/pan, wheel zoom, +/− / Fit
- **Cursor readout** — the exact frequency under the line (213 Hz reads 213, not the nearest
  band centre) plus the level of every visible trace and input
- **A/B frequency markers** — tap the RTA for marker A, tap again for B, drag either line to
  any frequency, then zoom the axis to just that span; the span is also shown in octaves and
  semitones
- **Pause measurement**, **track peak**, a peak-hold trace with a one-tap reset, full-screen views
- **View reset** — one button puts the zoom, Y offset and spectrograph window back to defaults
- **Temporal averaging** — **Fast, Slow and Inf** in Easy mode, with the full **1–10 plus Inf**
  scale in Advanced mode:
  - **Fast** — quick FIFO averaging (scale setting 2)
  - **Slow** — steadier frequency-weighted averaging (scale setting 6)
  - **1–3** — FIFO averages of 2, 4 or 8 FFT analysis frames; the oldest frame drops out
  - **4–10** — frequency-weighted exponential averaging, with longer time constants
    in the lows and shorter ones in the highs
  - **6** — the recommended general starting point
  - **Inf** — infinite running average, with a one-tap reset
- **Easy and Advanced modes** — Easy is the default and shows only banding, averaging,
  input, peak hold, display and setups; Advanced reveals FFT size, levels, trims, spectrograph
  detail, target curves and EQ export. Nothing is duplicated, and the choice is remembered;
  a one-time hint at the top of Settings points to the switch and disappears once dismissed
  or any mode is chosen
- **Banding** — 1, 1/3, 1/6, 1/12, 1/24, 1/48 octave; new installs start at 1/3 octave,
  the readable live-sound default, with the finer modes one change away
- **Two inputs (1+2)** — both channels of a stereo interface are analysed independently and
  overlaid on the RTA, each with its own trim; the RTA and the spectrograph can each follow
  either input
- **Input self-test** — reports the device name, microphone permission, channels requested and
  delivered, sample rate, bin width and the browser's DSP flags, with a live meter per channel,
  so you can see whether input 2 really carries signal before trusting 1+2; the same panel runs
  three internal reference tones through the analyzer and checks the band level and peak frequency
  against expected values, with no microphone needed
- **Calibrated dBFS bands** — 0 dBFS is a full-scale sine: the Blackman-windowed band power is
  corrected by 11.2 dB, so a −20 dBFS tone reads −20.0 dB, white noise rises 3 dB/octave, and
  bands above Nyquist are left empty instead of aliasing into a false top-octave spike
- **Honest waterfall readout** — the spectrograph stays logarithmic in every scale mode, and
  hovering a row decodes the level *that row* had and how long ago it was, rather than showing
  today's live level next to a historical timestamp
- **Live input meters** — a per-channel peak meter in the top bar (red on clip) and a **DEMO**
  chip, so a silent input or the demo signal is never mistaken for a real measurement; an
  **OFFLINE** chip appears when the app is running from its cache
- **Averaged reference captures** — record 3, 10, 30 or 60 seconds of the running average into a
  stored trace, for comparing a mic against a console feed over time
- **Markers on the spectrograph** — the same draggable A/B lines cross the waterfall, and the
  spectrograph readout lists the level at each marker for the selected moment
- **Daylight theme** — a high-contrast light palette (canvas included) for outdoor use, remembered
  per device, plus an install prompt where the browser supports one
- **Named setups** — save and recall banding, scales, target, zoom, markers, trims, channel mode
  and the EQ export options per venue
- **31-band EQ export options** — reference (target curve, 500 Hz – 2 kHz average, or 0 dB),
  1/3 or 1/6-octave smoothing, and either `Freq,Gain` or `Band,Freq,Gain` layout

**Pro tier (all included)**

- **RTA graph settings** — frequency scale (1/3 oct, octave, decade, linear), bars vs lines,
  foreground/background line thickness, Y-grid interval, grid on/off
- **RTA peak hold**, **Y offset**
- **Target curves** — genre house curves, cinema X-curves, plus import of your own:
  - Reference: flat 0 dB
  - Speech · corporate / theatre: no sub shelf, 1 dB/oct above 4 kHz, 2 dB top-octave shelf
  - Acoustic · jazz / folk / classical: +2 dB shelf below 90 Hz, 1 dB/oct from 5 kHz
  - Pop · top 40 / corporate party: +3 dB shelf below 80 Hz, 1 dB/oct from 3 kHz
  - Rock · club / live band: +4 dB shelf below 80 Hz, 1.2 dB/oct from 1 kHz
  - EDM · DJ / club: +6 dB shelf below 60 Hz, 0.6 dB/oct above 2 kHz
  - Stage monitors: vocal wedge (6 dB/oct HPF below 120 Hz, −2.5 dB at 315 Hz, +1.5 dB at
    3.15 kHz) and drum fill / side fill (+2.5 dB below 80 Hz, 400 Hz cut)
  - Vehicle: daily/SQ (+8 dB below 80 Hz, 2 dB shelf above 9 kHz) and bass-heavy/SPL
    (+12 dB below 60 Hz)
  - Home theatre: living room (+4 dB below 90 Hz) and small room / apartment (+2.5 dB, more HF roll)
  - Stereo listening: Harman in-room (+5 dB below 105 Hz, 0.9 dB/oct from 1 kHz) and a
    straight 1 dB/oct B&K-style tilt
  - Cinema X-curve: large room (flat to 2 kHz, then −3 dB/oct, per ISO 2969 / SMPTE ST 202)
    and small room (−1.5 dB/oct above 2 kHz)
  - The shape is built from four terms a tech actually adjusts — a low shelf, a constant tilt
    from a chosen corner, a top-octave shelf that saturates instead of sloping forever, and an
    HPF slope for monitors — plus named broad bands for the wedge cut and presence lift
  - Every preset is slotted onto the measured data, so only the shape matters, and the note
    under the curve picker quotes that curve's own 40 Hz and 10 kHz values so the description
    cannot drift from the shape; the active curve is named on the RTA plot
- **Data capture** — named, coloured, per-trace offset
- **Spatial averaging** — average stored traces into a new trace
- **One-tap delete** — × on each row, Delete for the ticked rows, Clear for everything
  (second tap confirms), plus Undo for the last removal
- **Import / export** — JSON and CSV, and a **31-band graphic-EQ CSV** (one gain per ISO
  third-octave centre, ±12 dB in 0.5 dB steps) taken against the target curve or the
  500 Hz – 2 kHz average

**Removed on purpose**

No SPL meter, gauge, traffic light, A/C weighting, Leq, NIOSH/OSHA exposure, or mic calibration
to absolute SPL. Everything is **relative full scale (dBFS)**; there is no absolute SPL anywhere.

---

## Input: microphones and interfaces

The app measures whatever the **operating system exposes as an audio input** — a browser cannot
talk to a driver directly, so there is no ASIO/CoreAudio equivalent here.

- Settings → **Input** lists every audio input and lets you pick one. The list fills in after the
  microphone permission is granted, because browsers hide device labels until then.
- **Input channel** — Mix sums, L / R read one side of a stereo interface through a channel
  splitter, and **1+2** measures both sides as two independent analyzers and overlays them on
  the RTA (input 1 filled, input 2 as a line). Each input has its own trim, stored per device.
  This is *beyond* the original: Smaart RTA Pro only ever uses an interface's **first** input.
- **Per-view input** — the RTA and the spectrograph each pick input 1 or input 2, so the
  spectrograph can watch the mic while the RTA shows the console feed.
- A class-compliant USB interface plugged into the tablet appears as an input, in Chrome, once
  the OS has enumerated it. On Android, USB audio requires the interface to be UAC1/UAC2
  compliant and may need an OTG adapter with enough power.
- The browser locks the sample rate (usually 48 kHz). There is no buffer-size control. Two
  inputs is the limit: each side of one stereo interface, or the mix.

---

## Run it

```bash
cd rta
node tools/serve.js 8123
```

Open `http://localhost:8123/`.

### On the Android tablets

The microphone needs a **secure context**, so use the published HTTPS URL, or for LAN testing add
the origin to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`. Then **⋮ → Add to Home
screen** for a fullscreen, offline-capable app. On Fire OS use Chrome, not Silk.

### Updating and deploying

The GitHub repository is the source of truth. The live app is served from the built
`deploy/dist` directory through Freebuff Sites (Cloudflare Workers), so a Git push
does not publish the site by itself.

```bash
cd rta
node tools/serve.js 8123             # test at http://localhost:8123/
node --check js/app.js
node --check sw.js
node --check deploy/worker.js
node tools/build-dist.js             # rebuild deploy/dist and validate references

git add -A
git commit -m "Describe the change"
git push                             # public GitHub repository
git push origin master               # external F: backup
```

Bump `CACHE` in `sw.js` (`rta-daddy-v23` at the time of writing) whenever the app
shell changes, or installed PWAs may keep serving the old bundle.

Or do the checks, build, commit, and both backup pushes in one command:

```bash
node tools/publish.js "Describe the change"
```

Use `node tools/publish.js --dry-run "Describe the change"` to run the checks and
build without committing or pushing. The script still does not deploy the live
site.

Then publish the rebuilt `deploy/manifest.json` to the existing Freebuff Sites
production environment at <https://rtadaddy.freebuff.page>. The GitHub Actions
workflow in `.github/workflows/build.yml` checks syntax and rebuilds `deploy/dist`
on every push to `master`; it does not publish the site.

---

## Controls

| Gesture / control | Action |
|---|---|
| One finger drag on RTA | Cursor readout at the exact frequency |
| Tap RTA | Set marker A, then B; drag either line to move it |
| Marker **Zoom** | Set the frequency axis to the A–B span |
| Rail **Reset** | Reset both plots: zoom, Y offset, spectro window, peak hold, live |
| Two fingers pinch / drag | Zoom and pan the frequency axis |
| Mouse wheel | Zoom at pointer |
| Drag the bar between plots | Resize the split |
| Rail **Graph** / **RTA** | Full-screen that plot (tap again to restore) |
| Rail **Pause** | Freeze, then use the rewind slider on the spectrograph |
| Rail **Trim + / −** | Nudge the input trim 1 dB per tap; tap the number to reset it to 0 |
| Header **Capture** | Store the current trace |
| Header **Traces** | Show, rename, offset, colour, average, delete |

`?demo=1` starts a synthetic signal so the UI can be exercised without a microphone.

---

## How it compares to Smaart RTA Pro

| | Smaart RTA Pro | This clone |
|---|---|---|
| Platform | native iOS/Android app, paid (sub or $149 lifetime) | web app / PWA, free, runs anywhere with Chrome |
| RTA + banding 1/48–1 oct | yes | yes |
| Averaging | 1–10 + Inf, frequency-weighted | Easy: Fast / Slow / Inf; Advanced: 1–10 + Inf |
| Spectrograph | 1000 slices, rewind, dynamic range | same |
| Frequency scale | 1/3 oct, decade, octave, linear | same |
| Bars/lines, thickness, grid interval | yes | yes |
| Peak hold, Y offset | yes | yes |
| Target curves | Cinema X + import | Cinema X + genre, monitor, car, home-theatre and stereo curves + import |
| Data capture + averaging | yes, with a data library | yes, with a simpler list |
| Interchange | `.srf`, compatible with Smaart desktop | **JSON / CSV only — no `.srf`** |
| External mic / interface | Pro only, **first input only** | any input the OS exposes, **plus L/R and 1+2 channel choice** |
| SPL metering + calibration | yes | **removed by request** |
| Measurement engine | Smaart's own, ~20 years in desktop products | `AnalyserNode` FFT with per-band power summing |
| Dual channel / transfer function / IR | no | two inputs measured and overlaid as separate RTAs — still no TF, phase or IR |

**Honest gaps:** no SPL (by design), no `.srf` interchange, no data-library workflow, no
microphone correction curves, no calibrated absolute levels, and the DSP is a browser FFT rather
than Smaart's engine — expect differences in resolution at the extremes and in low-frequency
behaviour. The 1+2 overlay is two independent RTAs, not a transfer function: no phase, no
coherence, no subtraction. It is a display-grade analyzer, not a certified instrument.

---

## Measurement notes

- Analysis is `AnalyserNode` FFT → power summed per fractional-octave band. 16 k FFT at 48 kHz is
  ~2.9 Hz per bin; at 1/48 octave the lowest bands are narrower than one bin, so very low
  frequency resolution is bin-limited. 32768 helps.
- Wider bands collect more noise power, so they read slightly higher on broadband material. That
  is physically correct.
- `getUserMedia` is opened with echo cancellation, noise suppression and auto gain control
  disabled — any of those left on visibly reshapes the spectrum.
- The browser has no analog gain, so a live input usually reads lower than a hardware RTA: the
  numbers are dBFS, not dB SPL, and the ~12 dB of auto gain control a browser would normally
  apply is deliberately skipped. **Auto Trim** (top bar, or Settings → RTA → Input trim) sets
  Input Trim so the loudest band lands ~6 dB below the top of the plot. It moves the reading,
  not the signal — signal-to-noise is unchanged.

---

## Files

```
rta/
  index.html            markup and settings sheet
  css/app.css           dark touch-first styling
  js/app.js             analysis, renderers, traces, gestures
  manifest.webmanifest  PWA manifest
  sw.js                 offline app-shell cache
  icons/                generated PNG icons + SVG
  deploy/worker.js      static-asset Worker + visit counter for hosting
  deploy/manifest.json  deploy manifest
  .github/workflows/build.yml  syntax/build check on push
  LICENSE               MIT
  social/               Instagram artwork + caption sheet
  tools/make-icons.js   regenerates the PNGs
  tools/gen-qr.js       regenerates the QR code
  tools/ig-ads.html     Instagram artwork generator
  tools/save-server.js  local server that writes the generator's PNGs
  tools/serve.js        tiny static server for local/LAN testing
  tools/build-dist.js   builds + validates deploy/dist
  tools/publish.js      validates, builds, commits, pushes both backups
  tools/test-hits.js    runs the counter Worker against a local SQLite shim
```

---

## Licensing

MIT — see [LICENSE](LICENSE).

Free for the community, made by an audio engineer for audio engineers: use it, copy it, change
it, hand it to a friend. Keep the copyright and warranty notice with any copy, and don't market
a copy as Smaart or imply Rational Acoustics endorses it.
