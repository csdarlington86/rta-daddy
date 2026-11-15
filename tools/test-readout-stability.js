#!/usr/bin/env node
/* Regression test: changing the Peak/Level text must not resize the readout
   group or move the live input meters. Runs the real app in headless
   Chrome/Edge at five responsive widths. */
'use strict';

const path = require('path');
const { openApp, sleep } = require('./lib/headless');

const ROOT = path.resolve(__dirname, '..');
const WIDTHS = [320, 375, 521, 768, 900];

async function run() {
  const startedAt = Date.now();
  const app = await openApp({
    root: ROOT,
    urlPath: '/app?readoutTest=1'
  });
  try {
    const results = [];
    for (const width of WIDTHS) {
      await app.cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false
      }, app.session);
      await sleep(80);

      const sample = await app.evaluate(`(() => {
        const peak = document.querySelector('#roPeak');
        const level = document.querySelector('#roLevel');
        const readouts = document.querySelector('.readouts');
        const meters = document.querySelector('#liveMeters');
        const measure = (p, l) => {
          peak.textContent = p;
          level.textContent = l;
          const readRect = readouts.getBoundingClientRect();
          const meterRect = meters.getBoundingClientRect();
          return {
            readW: +readRect.width.toFixed(2),
            meterX: +meterRect.x.toFixed(2),
            meterDisplay: getComputedStyle(meters).display
          };
        };
        /* Start with the meter in its normal live-input state so the wide
           widths exercise the element whose position must remain stable. */
        meters.classList.remove('hidden');
        return {
          short: measure('—', '—'),
          long: measure('19.9k', '-100.0 dB')
        };
      })()`);

      if (!(sample.short.readW > 0 && sample.long.readW > 0)) {
        throw new Error(width + ' px: readout group has no width');
      }
      if (sample.short.readW !== sample.long.readW) {
        throw new Error(width + ' px: readout width changed from ' + sample.short.readW + ' to ' + sample.long.readW);
      }
      if (sample.short.meterX !== sample.long.meterX) {
        throw new Error(width + ' px: live-meter x changed from ' + sample.short.meterX + ' to ' + sample.long.meterX);
      }
      if (width > 520 && sample.short.meterDisplay !== 'flex') {
        throw new Error(width + ' px: live meter is not visible for the wide-width check');
      }
      results.push({ width, readW: sample.short.readW, meterX: sample.short.meterX, display: sample.short.meterDisplay });
    }

    results.forEach((r) => {
      console.log('ok   ' + r.width + ' px: readout ' + r.readW.toFixed(1) + ' px; live meter ' +
        (r.display === 'none' ? 'hidden' : 'x=' + r.meterX.toFixed(1) + ' px'));
    });
    console.log('PASS readout stability regression (' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's)');
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('FAIL readout stability regression');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
