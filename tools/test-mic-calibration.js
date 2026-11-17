#!/usr/bin/env node
'use strict';

const path = require('path');
const { openApp } = require('./lib/headless');

const ROOT = path.resolve(__dirname, '..');

async function run() {
  const app = await openApp({ root: ROOT, urlPath: '/app?micCalibrationTest=1' });
  try {
    const result = await app.evaluate(`(async () => {
      const api = window.__micCalibrationTest;
      if (!api) throw new Error('calibration test API was not initialized');
      if (api.captureChannel('a', 'dual', 2) !== 'L' || api.captureChannel('b', 'dual', 2) !== 'R') throw new Error('1+2 did not map lanes to the device left/right channels');
      if (api.captureChannel('a', 'L', 2) !== 'L' || api.captureChannel('a', 'R', 2) !== 'R') throw new Error('Left/Right mode did not map lane a to the analyzed capture channel');
      if (api.captureChannel('a', 'mix', 2) !== null || api.captureChannel('b', 'dual', 1) !== 'L') throw new Error('stereo mix or mono input received a channel calibration');
      if (api.deviceId(true, false, 'stream-device', 'selected-device') !== 'stream-device') throw new Error('live stream device ID was not authoritative');
      if (api.deviceId(true, false, '', 'selected-device') !== '') throw new Error('live input without a reported device ID inherited the selected device calibration');
      if (api.deviceId(false, false, '', 'selected-device') !== 'selected-device') throw new Error('stopped input did not use the selected device');
      const points = api.parse('# response dB\\nFrequency (Hz),Mic Response (dB),Phase (deg)\\n100,0,2\\n1000,6,4\\n10000,0,8');
      if (points.length !== 3 || points[1][0] !== 1000) throw new Error('CSV/header parsing failed');
      const namedWithPhase = api.parse('Index,Frequency (Hz),Mic Response (dB),Phase (deg)\\n0,100,2,90\\n1,200,3,80');
      if (namedWithPhase.length !== 2 || namedWithPhase[1][1] !== 3) throw new Error('explicit response column with extra columns was not parsed correctly');
      const quoted = api.parse('"Frequency (Hz)","Mic Response (dB)","Phase (deg)"\\n100,2,90\\n200,3,80');
      if (quoted.length !== 2 || quoted[1][1] !== 3) throw new Error('quoted header parsing failed');
      if (Math.abs(api.at(1000, points) - 6) > 1e-9) throw new Error('exact-point interpolation failed');
      if (Math.abs(api.correct(-30, 1000, points) - (-36)) > 1e-9) throw new Error('positive mic response was not subtracted');
      const belowFlat = api.parse('100,0\\n1000,-4');
      if (Math.abs(api.correct(-30, 1000, belowFlat) - (-26)) > 1e-9) throw new Error('negative mic response was not added');
      if (api.correct(-30, 50, points) !== -30 || api.correct(-30, 20000, points) !== -30) throw new Error('out-of-range measurement was modified');
      if (Math.abs(api.at(316.227766, points) - 3) > 0.001) throw new Error('log-frequency interpolation failed');
      if (api.at(50, points) !== 0 || api.at(20000, points) !== 0) throw new Error('out-of-range correction is not zero');
      for (const invalid of ['# empty\\n', '100,2\\n100,3', '100,2\\n200,bad', '0,2\\n100,3', '100,-101\\n200,3', '100,2,90\\n200,3,80,1', '100,2,90,1\\n200,3,80,2', 'Frequency,Level,Correction\\n100,2,1\\n200,3,2', 'Frequency,Response (dB)\\n100,2,90,1\\n200,3,80', 'Frequency,Mic Response\\n100,2\\n200,3']) {
        let threw = false;
        try { api.parse(invalid); } catch (e) { threw = true; }
        if (!threw) throw new Error('invalid calibration data was accepted: ' + JSON.stringify(invalid));
      }
      const semicolon = api.parse('Frequency (Hz);Mic Response (dB);Phase (deg)\\n; exported by calibrator\\n100;1,5;20\\n200;2,5;30');
      if (semicolon.length !== 2 || semicolon[0][1] !== 1.5) throw new Error('semicolon decimal-comma file or semicolon-prefixed comment failed');
      const semicolonDot = api.parse('Frequency (Hz);Mic Response (dB)\\n100;1.5\\n200;2.5');
      if (semicolonDot.length !== 2 || semicolonDot[1][1] !== 2.5) throw new Error('semicolon-delimited decimal-point file failed');
      const tabbed = api.parse('Frequency (Hz)\\tMic Response (dB)\\tPhase (deg)\\n100\\t1\\t20\\n200\\t2\\t30');
      if (tabbed.length !== 2 || tabbed[1][1] !== 2) throw new Error('tab-delimited file failed');
      const dotComma = api.parse('Frequency (Hz),Mic Response (dB)\\n100,1.5\\n200,2.5');
      if (dotComma.length !== 2 || dotComma[1][1] !== 2.5) throw new Error('comma-delimited decimal point failed');
      for (const invalid of ['Frequency (Hz),Mic Response (dB)\\n100 Hz,2 dB\\n200 Hz,3 dB', '100,2\\nInfinity,3', '1e3,NaN\\n2e3,3', 'Frequency (Hz),Mic Response (dB)\\n100,1;5\\n200,2;5', 'Frequency (Hz)\\tMic Response (dB)\\n100,1\\t2\\n200,3\\t4', 'Frequency (Hz);Mic Response (dB)\\n; comment\\n100;1;5\\n200;2;5']) {
        let threw = false;
        try { api.parse(invalid); } catch (e) { threw = true; }
        if (!threw) throw new Error('malformed or mixed-delimiter calibration data was accepted: ' + JSON.stringify(invalid));
      }

      localStorage.removeItem('rtapro.miccal.v1');
      const sel = document.querySelector('#micSelect');
      const opt = document.createElement('option');
      opt.value = 'test-input-A'; opt.textContent = 'Test input A'; sel.appendChild(opt);
      sel.value = 'test-input-A'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-seg="chan"] [data-value="L"]').click();
      const input = document.querySelector('#micCalibrationFile');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['100,2\\n1000,-3'], 'mic.cal', { type: 'text/plain' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const stored = JSON.parse(localStorage.getItem('rtapro.miccal.v1') || '{}');
      if (!stored['test-input-A:L'] || stored['test-input-A:L'].name !== 'mic.cal') throw new Error('upload did not persist under selected device and left channel');
      if (!api.calibration('test-input-A', 'L') || api.calibration('test-input-A', 'L').name !== 'mic.cal' || api.calibration('test-input-A', 'R') !== null) throw new Error('left-channel calibration was not scoped to the left channel');
      if (document.querySelector('#micCalibrationStatus').textContent.indexOf('left channel') < 0) throw new Error('uploaded calibration channel missing from status');
      const savedList = document.querySelector('#micCalibrationSaved');
      if (!Array.from(savedList.options).some((o) => o.value === 'test-input-A:L' && /Test input A/.test(o.textContent))) throw new Error('saved curve list did not show the device label and channel');
      const badge = document.querySelector('#calBadge');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL L') throw new Error('active calibration badge missing');
      const applyBox = document.querySelector('#micCalibrationApply');
      if (!applyBox.checked || !api.appliedCalibration('test-input-A', 'L')) throw new Error('calibration was not applied by default');
      applyBox.checked = false; applyBox.dispatchEvent(new Event('change', { bubbles: true }));
      if (api.appliedCalibration('test-input-A', 'L') !== null) throw new Error('bypass did not stop calibration');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL OFF') throw new Error('bypass was not shown on the badge');
      applyBox.checked = true; applyBox.dispatchEvent(new Event('change', { bubbles: true }));
      if (!api.appliedCalibration('test-input-A', 'L') || badge.textContent !== 'CAL L') throw new Error('re-enabling calibration failed');
      const other = document.createElement('option');
      other.value = 'test-input-B'; other.textContent = 'Test input B'; sel.appendChild(other);
      sel.value = 'test-input-B'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (document.querySelector('#micCalibrationStatus').textContent.indexOf('No calibration') !== 0) throw new Error('calibration leaked to another device');
      if (api.calibration('test-input-B', 'L') !== null) throw new Error('calibration lookup leaked across devices');
      if (api.calibration('', 'L') !== null || api.calibration(null, 'R') !== null) throw new Error('missing device ID inherited a stored calibration');
      savedList.value = 'test-input-A:L';
      document.querySelector('#btnUseMicCalibration').click();
      const reassigned = JSON.parse(localStorage.getItem('rtapro.miccal.v1') || '{}');
      if (!reassigned['test-input-B:L'] || reassigned['test-input-B:L'].label !== 'Test input B') throw new Error('saved curve was not reassigned with the current device label');
      if (!api.calibration('test-input-B', 'L') || api.calibration('test-input-B', 'R') !== null) throw new Error('reassigned curve was not activated on the right channel only');
      document.querySelector('#btnRemoveMicCalibration').click();
      const afterReassignRemove = JSON.parse(localStorage.getItem('rtapro.miccal.v1') || '{}');
      if (afterReassignRemove['test-input-B:L'] || !afterReassignRemove['test-input-A:L']) throw new Error('removing the reassigned curve changed another input');
      if (api.calibration('test-input-B', 'L') !== null) throw new Error('removed reassigned curve remained active');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL !') throw new Error('inactive session curve did not leave a persistent badge');
      sel.value = 'test-input-A'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const channelSelect = document.querySelector('#micCalibrationChannel');
      const raw = [-30];
      const input1Corrected = api.correct(raw[0], 1000, stored['test-input-A:L'].points);
      if (api.correct(raw[0], 1000, api.calibration('test-input-A', 'R')?.points || null) !== -30) throw new Error('right channel received the left-channel correction');
      channelSelect.value = 'R'; channelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (document.querySelector('#micCalibrationStatus').textContent.indexOf('No calibration') !== 0) throw new Error('left-channel calibration appeared on the right channel');
      const input2Transfer = new DataTransfer();
      input2Transfer.items.add(new File(['100,0\\n1000,4'], 'mic-input-2.cal', { type: 'text/plain' }));
      input.files = input2Transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 50));
      const dualStored = JSON.parse(localStorage.getItem('rtapro.miccal.v1') || '{}');
      if (!dualStored['test-input-A:R']) throw new Error('right-channel calibration did not persist independently');
      if (api.calibration('test-input-A', 'L')?.name !== 'mic.cal' || api.calibration('test-input-A', 'R')?.name !== 'mic-input-2.cal') throw new Error('device/channel calibration lookup was not isolated');
      if (Math.abs(api.correct(raw[0], 1000, api.calibration('test-input-A', 'R').points) - (-34)) > 1e-9) throw new Error('right channel did not use its own calibration');
      if (Math.abs(api.correct(raw[0], 1000, api.calibration('test-input-A', 'L').points) - (-27)) > 1e-9) throw new Error('left calibration changed while the right channel was set');
      channelSelect.value = 'L'; channelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      if (document.querySelector('#micCalibrationStatus').textContent.indexOf('mic.cal') < 0) throw new Error('Input 1 calibration was not retained separately');
      channelSelect.value = 'R'; channelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#btnRemoveMicCalibration').click();
      const afterRemove = JSON.parse(localStorage.getItem('rtapro.miccal.v1') || '{}');
      if (!afterRemove['test-input-A:L'] || afterRemove['test-input-A:R']) throw new Error('remove did not clear only the selected channel calibration');
      if (document.querySelector('#micCalibrationStatus').textContent.indexOf('No calibration') !== 0) throw new Error('remove status not updated');
      const chanSeg = document.querySelector('[data-seg="chan"]');
      const trimA = document.querySelector('#trimRowA input[data-setting="trim"]');
      chanSeg.querySelector('[data-value="R"]').click();
      if (document.querySelector('#trimLabelA').textContent.indexOf('Right') < 0 || !document.querySelector('#trimRowB').classList.contains('hidden')) throw new Error('Right mode did not select the right-channel trim');
      trimA.value = '7'; trimA.dispatchEvent(new Event('input', { bubbles: true }));
      const settingsR = JSON.parse(localStorage.getItem('rtapro.settings.v1') || '{}');
      if (settingsR.trimsB['test-input-A'] !== 7) throw new Error('right-channel trim was not stored separately');
      chanSeg.querySelector('[data-value="L"]').click();
      if (document.querySelector('#trimLabelA').textContent.indexOf('Left') < 0 || Number(trimA.value) !== 0) throw new Error('Left mode did not restore the left-channel trim');
      trimA.value = '3'; trimA.dispatchEvent(new Event('input', { bubbles: true }));
      chanSeg.querySelector('[data-value="R"]').click();
      if (Number(trimA.value) !== 7) throw new Error('right-channel trim did not survive a mode change');
      chanSeg.querySelector('[data-value="mix"]').click();
      if (document.querySelector('#trimLabelA').textContent.indexOf('Mix') < 0 || !document.querySelector('#trimRowB').classList.contains('hidden')) throw new Error('Mix mode did not select the mix trim');
      if (Number(trimA.value) !== 3) throw new Error('mix trim did not start from the legacy channel-1 value');
      trimA.value = '5'; trimA.dispatchEvent(new Event('input', { bubbles: true }));
      const settingsM = JSON.parse(localStorage.getItem('rtapro.settings.v1') || '{}');
      if (settingsM.trimsM['test-input-A'] !== 5 || settingsM.trims['test-input-A'] !== 3) throw new Error('mix trim was not stored separately from the left channel');
      return { points: points.length, interpolationDb: api.at(316.227766, points), devicePersistence: true, perChannel: true, remove: true, bypass: true, reassign: true, channelTrims: true };
    })()`);
    console.log('ok   parsed explicit headers with extra phase column; rejected ambiguous numeric columns; interpolated in log frequency');
    console.log('ok   applied inverse response with unchanged levels outside calibration range');
    console.log('ok   upload persisted by device and left/right channel; bypass, reassignment, and channel trims worked');
    console.log('PASS microphone calibration regression', JSON.stringify(result));
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('FAIL microphone calibration regression');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
