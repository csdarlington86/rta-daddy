#!/usr/bin/env node
'use strict';

const path = require('path');
const { openApp } = require('./lib/headless');

const ROOT = path.resolve(__dirname, '..');

const settings = {
  calVersion: 2,
  trimChannelsVersion: 2,
  uiMode: 'advanced',
  micId: 'reload-mic',
  chanMode: 'L',
  trim: 0,
  trimB: 0,
  trims: {},
  trimsB: {},
  trimsM: {}
};

const calibrations = {
  'reload-mic:L': {
    name: 'reload.cal',
    label: 'Reload input',
    points: [[100, 0], [1000, 3], [10000, 0]]
  }
};

const initScript = `(() => {
  if (sessionStorage.getItem('rtaReloadSeeded')) return;
  sessionStorage.setItem('rtaReloadSeeded', '1');
  localStorage.setItem('rtapro.settings.v1', ${JSON.stringify(JSON.stringify(settings))});
  localStorage.setItem('rtapro.miccal.v1', ${JSON.stringify(JSON.stringify(calibrations))});
})();`;

async function run() {
  const app = await openApp({
    root: ROOT,
    urlPath: '/app?micCalibrationTest=1',
    initScript
  });
  try {
    const before = await app.evaluate(`(() => {
      const api = window.__micCalibrationTest;
      if (!api) throw new Error('calibration test API was not initialized');
      const badge = document.querySelector('#calBadge');
      const guard = document.querySelector('#calGuard');
      const status = document.querySelector('#micCalibrationStatus');
      const list = document.querySelector('#micCalibrationSaved');
      const inactive = (where) => {
        if (api.calibration('reload-mic', 'L') !== null) throw new Error('saved curve was active ' + where);
        if (api.appliedCalibration('reload-mic', 'L') !== null) throw new Error('calibration was applied ' + where);
        if (!badge || !badge.classList.contains('hidden')) throw new Error('calibration badge was visible ' + where);
        if (!guard || !guard.classList.contains('hidden')) throw new Error('calibration guard was visible ' + where);
        if (!status || status.textContent.indexOf('inactive') < 0) throw new Error('status did not say inactive ' + where);
        if (!list || !list.value) throw new Error('saved curve was missing ' + where);
      };
      inactive('after boot');
      document.querySelector('#btnUseMicCalibration').click();
      if (!api.appliedCalibration('reload-mic', 'L')) throw new Error('explicit activation failed');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL L') throw new Error('active badge did not appear');
      if (!guard.classList.contains('hidden')) throw new Error('calibration guard appeared while the curve applied');
      return { bootInactive: true, useActivated: true, savedKey: list.value };
    })()`);

    await app.reload();

    const after = await app.evaluate(`(() => {
      const api = window.__micCalibrationTest;
      if (!api) throw new Error('calibration test API was not initialized after reload');
      const badge = document.querySelector('#calBadge');
      const guard = document.querySelector('#calGuard');
      const status = document.querySelector('#micCalibrationStatus');
      const list = document.querySelector('#micCalibrationSaved');
      if (api.calibration('reload-mic', 'L') !== null) throw new Error('saved curve reactivated on reload');
      if (api.appliedCalibration('reload-mic', 'L') !== null) throw new Error('calibration was applied after reload');
      if (!badge || !badge.classList.contains('hidden')) throw new Error('calibration badge survived reload');
      if (!guard || !guard.classList.contains('hidden')) throw new Error('calibration guard survived reload');
      if (!status || status.textContent.indexOf('inactive') < 0) throw new Error('reload status did not say inactive');
      if (!list || !list.value) throw new Error('saved curve did not survive reload');
      document.querySelector('#btnUseMicCalibration').click();
      if (!api.appliedCalibration('reload-mic', 'L')) throw new Error('explicit activation after reload failed');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL L') throw new Error('active badge did not appear after reload');
      if (!guard.classList.contains('hidden')) throw new Error('guard appeared after use on reload');
      return { reloadInactive: true, useActivated: true, savedKey: list.value };
    })()`);

    console.log('ok   saved curve stayed inactive after boot until Use was clicked');
    console.log('ok   saved curve stayed inactive after reload until Use was clicked');
    console.log('PASS calibration reload regression ' + JSON.stringify({ before, after }));
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
