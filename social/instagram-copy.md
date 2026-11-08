# RTA Daddy — Instagram kit

Everything here is drawn by `tools/ig-ads.html` and written into `social/` by
`tools/save-server.js`. Regenerate any time:

```
node tools/save-server.js 8128      # then open http://127.0.0.1:8128/tools/ig-ads.html
```

## The files

| File | Size | Use |
| --- | --- | --- |
| `ig-feed-hero.png` | 1080×1080 | Feed post / profile grid — brand + promise |
| `ig-feed-features.png` | 1080×1080 | Feed post — what is inside |
| `ig-feed-spectro.png` | 1080×1080 | Feed post — spectrograph + rewind |
| `ig-feed-honest.png` | 1080×1080 | Feed post — no account / no SPL meter |
| `ig-feed-card.png` | 1080×1080 | **Send this in DMs or print it** — scannable link card |
| `ig-feed-offline.png` | 1080×1080 | Feed post — **online once, then no internet** |
| `ig-story-hero.png` | 1080×1920 | Story 1 of a set |
| `ig-story-spectro.png` | 1080×1920 | Story 2 — the new rewind / level controls |
| `ig-story-honest.png` | 1080×1920 | Story 3 — the honest pitch |
| `ig-story-offline.png` | 1080×1920 | Story 3b — the offline story |
| `ig-story-qr.png` | 1080×1920 | Story 4 — scan-to-open card |

Story files keep key content between y≈250 and y≈1560, so Instagram's header,
caption, sticker tray and reply bar do not sit on top of the artwork.

## Getting people to the app (the professional route)

1. **Bio link.** Instagram gives you one clickable link. Put the app in it:
   `https://site-60ea1d07501e4fd1a0d91f5bd0cc5293.freebuff.page/app`
   and set the bio to:
   > 100% free RTA + spectrograph for your tablet.
   > No account. No SPL meter. Open it in the browser 👇
2. **Link sticker in stories.** Every story can carry the Link sticker pointing
   at the same URL, labelled **"Open RTA Daddy"**. That is the tappable path;
   the artwork already says "Link in bio" for the fallback.
3. **DM or in-person: send `ig-feed-card.png`.** It is a scannable code, so
   nobody has to type a URL or hunt the bio. Same code as `qr/rta-daddy-qr.png`,
   which is 2048 px and ECC-H — good for printing at 40 mm or bigger.
4. **DM the plain link too** — it unfurls the app's own preview card (logo,
   title and "100% Free RTA and Spectrograph"), not a bare URL.

A custom domain would make the typed URL pretty (`rtadaddy.com/app` style);
until then the QR and bio link carry it.

## Feed captions

Each caption: hook line, two or three short paragraphs, one call to action,
hashtags, then alt text (paste into Instagram's "Write alt text").

### 1 — `ig-feed-hero.png`
> A real analyzer, in the browser on the tablet you already own.
>
> 1 octave down to 1/48, a spectrograph that scrolls with time, live-sound and
> cinema target curves, captured traces you can export. No install, no account,
> no subscription — open the link and allow the microphone.
>
> Deliberately no SPL metering: an honest SPL number needs a calibrated mic, so
> this one does not pretend to give you one.
>
> Open it from the link in bio. 100% free.
>
> #rta #realtimeanalyzer #spectrograph #livesound #audioproduction #pasmusic
> #soundengineer #proaudio #frfr #livemusic #audiotech #soundcheck #diyaudio
>
> Alt: Dark card with the RTA Daddy bar-graph logo, the words "100% Free RTA and
> Spectrograph", and three pills reading No account, No subscription, No SPL meter.

### 2 — `ig-feed-features.png`
> Everything a small room needs, nothing it doesn't.
>
> • 1/48-octave RTA, bars or line, peak hold and averaging
> • Spectrograph with time scrolling up — drag it back to see what just happened
> • Live-sound and cinema targets, or import your own curve
> • Captured traces, compared side by side, exported as CSV or JSON
>
> Runs in Chrome on an Android tablet, and on any desktop browser. Install it to
> the home screen and it works offline.
>
> Link in bio.
>
> #rta #spectrograph #targetcurve #audioproduction #pa #livesound #mixengineer
> #sounddesign #proaudio #acoustics #tabletaudio #freeplugins
>
> Alt: Feature list card headed "Everything a small room needs" with four green
> bullets: 1/48 octave RTA, spectrograph, target curves, traces and export.

### 3 — `ig-feed-spectro.png`
> See what the room is doing while it is happening.
>
> The spectrograph puts frequency across the bottom and time scrolling up, so a
> ringing room, a feedback ring or a dead HF driver shows up as a shape you can
> read instantly. Drag it up or down to walk back through the last few seconds;
> touch it to get the exact Hz and level under your finger.
>
> Min and max level sit right on the graph, so you can set the window mid-show
> without opening a menu.
>
> Free, in the browser. Link in bio.
>
> #spectrograph #rta #feedback #livesound #audioproduction #pasmusic
> #soundengineer #roomacoustics #audiotech #proaudio #mixing #soundcheck
>
> Alt: Simulated spectrogram in green with frequency ticks, a min and max slider
> under it, and the line "Drag the graph up or down to rewind".

### 4 — `ig-feed-honest.png`
> No account. No subscription. No SPL meter.
>
> The first two are the whole point. The third is a choice: a trustworthy SPL
> reading needs a calibrated measurement mic and a reference calibrator, and a
> tablet mic would only give you a confident-looking wrong number. So RTA Daddy
> measures what it can actually measure, properly.
>
> RTA, spectrograph, target curves, traces — free, offline-capable, no sign-up.
>
> Link in bio.
>
> #rta #spl #livesound #audioproduction #proaudio #soundengineer #pasmusic
> #measurement #acoustics #freeware #tablet #diyaudio
>
> Alt: Dark card with three stacked lines — No account. No subscription. No SPL
> meter. — the last in bright green, with a short explanation underneath.

### 5 — `ig-feed-card.png`
> Save this one. Point your camera at the code and the analyzer opens.
>
> 100% free RTA and spectrograph for Android tablets and any browser. No install,
> no account, no SPL metering. Works offline once it has loaded.
>
> Scan it, or use the link in bio.
>
> #rta #qrtag #livesound #audioproduction #spectrograph #proaudio #pasmusic
> #soundengineer #tabletaudio #freeware #audiotech #livemusic
>
> Alt: RTA Daddy wordmark above a large QR code on a white rounded plate, with
> "Scan to open" underneath.

### 6 — `ig-feed-offline.png`
> Open it once online. After that the internet is optional.
>
> The first time you open RTA Daddy, your browser downloads the whole app — one
> page, a stylesheet, one script, the icons, about half a megabyte — and keeps its
> own copy. From then on the microphone, the RTA, the spectrograph, the targets and
> your traces all run on the tablet itself. Switch Wi-Fi and mobile data off and it
> measures exactly the same.
>
> So the order is: one online visit, then measure anywhere. There is no app-store
> download and no installer — the browser holds the copy and hands it back to you
> each time you open it.
>
> One caveat worth repeating: on a network that is up but has no internet behind it
> — a mixer network, a guest Wi-Fi that never logged in — the browser tries the
> network first, so that first open can take a couple of seconds before it falls
> back to the stored copy. It always opens; it just is not instant on that kind of
> network.
>
> Free, no account, no SPL meter. Link in bio.
>
> #livesound #rta #offline #audioproduction #proaudio #soundcheck #pasmusic
> #soundengineer #tabletaudio #audiotech #livemusic #freeware
>
> Alt: Dark card with a crossed-out Wi-Fi symbol, the words "Online once." in white
> and "Offline after." in bright green, over two numbered steps: 1 Open it once,
> online — the whole app downloads into your browser; 2 Then measure with no
> internet — free, no account, no data used.

## Story frames

Post them as one sequence; add the Link sticker to each.

1. **`ig-story-hero.png`** — sticker text: *"Free RTA + spectrograph"*. Link
   sticker label: **Open RTA Daddy**.
2. **`ig-story-spectro.png`** — sticker text: *"drag it back in time"*.
3. **`ig-story-honest.png`** — sticker text: *"no account, no licence"*.
4. **`ig-story-qr.png`** — sticker text: *"scan this"*, and a poll
   ("Tablet or laptop?") if you want the reply engagement.
5. **`ig-story-offline.png`** — sticker text: *"online once, then no internet"*.
   Good one to pin after a post where someone asked whether it needs internet.

## Cadence that fits one person

- **Week 1:** post `ig-feed-hero`, run the four stories the same day.
- **Week 3:** `ig-feed-spectro` + a story reshowing the rewind.
- **Week 5:** `ig-feed-features`.
- **Week 7:** `ig-feed-honest`.
- Keep `ig-feed-card` for DMs, venue noticeboards and anyone who asks
  "what's the app?".
- **When someone asks about internet**, answer with `ig-feed-offline` in the feed
  and `ig-story-offline` as the story — and say the honest part too: load it
  once, then it runs with the radio off.

Every claim in these captions matches what the app actually does — if a feature
changes, change the caption with it. Nothing here promises SPL, dual-channel
transfer functions, or anything that needs a licence.
