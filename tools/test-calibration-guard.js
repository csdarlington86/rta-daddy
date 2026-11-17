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
      if (!api || !api.guard) throw new Error('calibration test API was not initialized');
      const sel = document.querySelector('#micSelect');
      const guard = document.querySelector('#calGuard');
      const guardText = document.querySelector('#calGuardText');
      const relink = document.querySelector('#btnCalGuardRelink');
      const use = document.querySelector('#btnCalGuardUse');
      const dismiss = document.querySelector('#btnCalGuardDismiss');
      const badge = document.querySelector('#calBadge');
      const sheet = document.querySelector('#sheet');
      const savedList = document.querySelector('#micCalibrationSaved');
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const hidden = () => guard.classList.contains('hidden');
      const addDevice = (value, label) => {
        if (Array.from(sel.options).some((option) => option.value === value)) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        sel.appendChild(option);
      };
      const pickDevice = (value) => {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const pickMode = (value) => {
        document.querySelector('[data-seg="chan"] [data-value="' + value + '"]').click();
      };
      const upload = async (name, text) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], name, { type: 'text/plain' }));
        const input = document.querySelector('#micCalibrationFile');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(50);
      };
      const openRelinkPreview = () => {
        relink.click();
        if (relink.textContent !== 'Confirm relink') throw new Error('Relink did not open a preview');
        if (use.textContent !== 'Use saved' || !use.classList.contains('hidden')) throw new Error('Relink preview did not hide Use saved');
        if (dismiss.textContent !== 'Cancel') throw new Error('Relink preview did not offer Cancel');
        return guardText.textContent;
      };
      const relinkNow = () => {
        openRelinkPreview();
        relink.click();
      };

      if (!hidden()) throw new Error('calibration guard was visible before a curve was active');

      pickMode('L');
      addDevice('guard-A', 'Guard input A');
      addDevice('guard-B', 'Guard input B');
      pickDevice('guard-A');
      await upload('guard.cal', ['100,2', '1000,-3'].join(String.fromCharCode(10)));
      if (!api.calibration('guard-A', 'L')) throw new Error('guard fixture did not activate a left curve');
      if (api.guard() !== null) throw new Error('guard reported a problem while the curve applied');
      if (!hidden()) throw new Error('guard was visible while the curve applied');

      pickDevice('guard-B');
      let info = api.guard();
      if (!info || info.reason !== 'device') throw new Error('device change did not raise the guard');
      if (hidden()) throw new Error('device-change guard was not visible');
      if (!/Guard input A/.test(guardText.textContent)) throw new Error('device-change warning did not name the previous input');
      if (relink.disabled) throw new Error('device-change guard did not offer relink');
      const previewText = openRelinkPreview();
      if (!/Relink Guard input A/.test(previewText) || !/Layout|Guard input B/.test(previewText)) {
        throw new Error('relink preview did not name the source and target inputs');
      }
      relink.click();
      if (!api.calibration('guard-B', 'L')) throw new Error('relink did not activate the curve on the current input');
      if (!hidden()) throw new Error('guard stayed visible after relink');
      const undoButton = document.querySelector('#toastAction');
      if (!undoButton || undoButton.textContent !== 'Undo' || undoButton.classList.contains('hidden')) {
        throw new Error('relink did not offer Undo');
      }
      undoButton.click();
      if (api.calibration('guard-B', 'L') !== null || !api.calibration('guard-A', 'L')) {
        throw new Error('Undo did not restore the pre-relink active state');
      }
      if (Array.from(savedList.options).some((option) => option.value === 'guard-B:L')) {
        throw new Error('Undo left the relinked saved curve in the picker');
      }
      if (hidden()) throw new Error('Undo left the guard hidden');
      relinkNow();
      if (!api.calibration('guard-B', 'L') || !hidden()) throw new Error('relink after Undo failed');

      /* A single active channel already applies in 1+2; relinking a changed
         input must not narrow the measurement to Left or Right. */
      addDevice('guard-C', 'Guard input C');
      pickMode('dual');
      pickDevice('guard-C');
      if (hidden()) throw new Error('device-change guard did not appear in 1+2 mode');
      relinkNow();
      if (!document.querySelector('[data-seg="chan"] [data-value="dual"]').classList.contains('active')) {
        throw new Error('relink dropped 1+2 mode even though the left curve applies there');
      }
      if (!api.calibration('guard-C', 'L')) throw new Error('1+2 relink did not activate the curve');
      if (!hidden()) throw new Error('guard stayed visible after 1+2 relink');

      /* Right-only curves apply to the second channel in 1+2; preserve it too. */
      addDevice('guard-D', 'Guard input D');
      addDevice('guard-E', 'Guard input E');
      pickDevice('guard-D');
      document.querySelector('#micCalibrationChannel').value = 'R';
      document.querySelector('#micCalibrationChannel').dispatchEvent(new Event('change', { bubbles: true }));
      await upload('guard-right.cal', ['100,0', '1000,4'].join(String.fromCharCode(10)));
      if (!api.calibration('guard-D', 'R')) throw new Error('right-only 1+2 fixture did not activate');
      if (api.calibration('guard-D', 'L') !== null) throw new Error('right-only 1+2 fixture leaked into the left channel');
      if (!hidden()) throw new Error('right-only curve did not apply in 1+2 mode');
      pickDevice('guard-E');
      if (hidden()) throw new Error('right-only 1+2 device change did not raise the guard');
      relinkNow();
      if (!document.querySelector('[data-seg="chan"] [data-value="dual"]').classList.contains('active')) {
        throw new Error('relink dropped 1+2 mode even though the right curve applies there');
      }
      if (!api.calibration('guard-E', 'R')) throw new Error('right-only 1+2 relink did not activate the curve');
      if (!hidden()) throw new Error('guard stayed visible after right-only 1+2 relink');

      pickDevice('');
      info = api.guard();
      if (!info || info.reason !== 'no-id') throw new Error('missing device ID did not raise the guard');
      if (hidden()) throw new Error('no-ID guard was not visible');
      if (!/device ID/i.test(guardText.textContent)) throw new Error('no-ID warning did not explain the missing ID');
      if (relink.disabled || relink.textContent !== 'Reopen input') throw new Error('no-ID guard did not offer Reopen input');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL !') throw new Error('no-ID state lost the persistent inactive badge');
      pickDevice('guard-B');

      pickMode('mix');
      info = api.guard();
      if (!info || info.reason !== 'mix') throw new Error('stereo Mix did not raise the guard');
      if (hidden()) throw new Error('Mix guard was not visible');
      if (!/Mix/.test(guardText.textContent)) throw new Error('Mix warning did not mention Mix');
      relinkNow();
      if (!document.querySelector('[data-seg="chan"] [data-value="L"]').classList.contains('active')) {
        throw new Error('relink from Mix did not switch to an applicable channel mode');
      }
      if (!hidden()) throw new Error('guard stayed visible after relink from Mix');

      pickMode('mix');
      if (hidden()) throw new Error('Mix guard did not return for the saved-curve action');
      use.click();
      await wait(20);
      if (!sheet.classList.contains('open')) throw new Error('Use saved did not open settings');
      if (!document.querySelector('.seg[data-seg="tab"] .segBtn[data-tab="input"]').classList.contains('active')) {
        throw new Error('Use saved did not select the Input tab');
      }
      if (!savedList || savedList.disabled) throw new Error('Use saved did not expose the saved-curve picker');
      if (!api.calibration('guard-B', 'L')) throw new Error('Use saved changed the active curve unexpectedly');
      document.querySelector('#sheetClose').click();
      if (hidden()) throw new Error('guard cleared merely by opening saved curves');

      dismiss.click();
      if (!hidden()) throw new Error('Continue did not dismiss the guard');
      if (badge.classList.contains('hidden') || badge.textContent !== 'CAL !') throw new Error('Continue hid the persistent inactive badge');
      pickMode('R');
      if (hidden()) throw new Error('guard did not return after a new applicability problem');
      if (!/right channel|Right mode/.test(guardText.textContent)) throw new Error('channel-mismatch warning was unclear');
      relinkNow();
      if (!hidden()) throw new Error('guard stayed visible after channel-mismatch relink');
      if (badge.textContent !== 'CAL L') throw new Error('active badge did not return after relink');

      return {
        deviceChange: true,
        previewUndo: true,
        inactiveBadge: true,
        noIdReopen: true,
        mix: true,
        relink: true,
        dualPreserved: true,
        dualRightPreserved: true,
        useSaved: true,
        continuePersistent: true
      };
    })()`);
    console.log('ok   warned and offered relink when the input ID changed');
    console.log('ok   warned when the input reported no ID; Reopen input was offered');
    console.log('ok   warned in Mix mode; relink switched to an applicable channel');
    console.log('ok   relink kept 1+2 for a left-only active curve');
    console.log('ok   relink kept 1+2 for a right-only active curve');
    console.log('ok   relink preview required confirmation and Undo restored the prior state');
    console.log('ok   Continue left a persistent CAL ! badge');
    console.log('ok   Use saved opened the Input tab without changing the active curve');
    console.log('ok   Continue dismissed the warning; a new applicability problem showed it again');
    console.log('PASS calibration applicability guard regression', JSON.stringify(result));
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
