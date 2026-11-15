#!/usr/bin/env node
/* Regression test: arm Capture when settled, capture now, and verify the wait
   is cancelled before the signal settles. Runs the real app in a headless
   Chrome/Edge with a synthetic steady microphone, so it needs no package
   install and never touches the user's browser profile. */
'use strict';

const path = require('path');
const { openApp } = require('./lib/headless');

const ROOT = path.resolve(__dirname, '..');

async function runCaptureTest() {
  const startedAt = Date.now();
  const app = await openApp({
    root: ROOT,
    urlPath: '/app?demo=1&captureTest=1',
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  try {
    const expression = '(' + (async function captureCancelTest() {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const $ = (selector) => document.querySelector(selector);
      const waitFor = async (predicate, label, timeout) => {
        const end = Date.now() + (timeout || 10000);
        while (Date.now() < end) {
          if (predicate()) return;
          await wait(100);
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const badge = () => Number($('#traceBadge').textContent);

      await waitFor(() => $('#btnStart') && document.readyState === 'complete', 'the app');
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio || !navigator.mediaDevices) throw new Error('Audio capture is unavailable in this browser');
      /* The test needs a genuinely steady response, not a noisy synthetic mic.
         Keep the media-stream plumbing real but make each analyser return a
         flat, constant frequency response so the settle path is deterministic. */
      const createAnalyser = Audio.prototype.createAnalyser;
      Audio.prototype.createAnalyser = function () {
        const analyser = createAnalyser.apply(this, arguments);
        analyser.getFloatFrequencyData = function (array) { array.fill(-30); };
        return analyser;
      };
      const context = new Audio({ sampleRate: 48000 });
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 1000;
      gain.gain.value = 0.2;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      navigator.mediaDevices.getUserMedia = async () => destination.stream;

      $('#btnStart').click();
      await waitFor(() => !$('#liveMeters').classList.contains('hidden'), 'microphone start', 12000);
      const before = badge();

      /* Clear the settled history, arm, then capture before the steady signal
         reaches SETTLED. A missing cancellation lets the settle path add a
         second trace and the final count check fails. */
      $('#railViewReset').click();
      await waitFor(() => $('#avgState') && !$('#avgState').classList.contains('hidden'), 'average data', 5000);
      await wait(200);
      $('#btnCaptureStableMain').click();
      if ($('#btnCaptureStableMain').getAttribute('aria-pressed') !== 'true') {
        throw new Error('header did not arm Capture when settled');
      }
      if ($('#btnCaptureStable').getAttribute('aria-pressed') !== 'true') {
        throw new Error('drawer did not arm Capture when settled');
      }
      $('#btnCaptureMain').click();
      const afterManual = badge();
      if (afterManual !== before + 1) {
        throw new Error('manual Capture should increment the trace count exactly once, got ' + before + ' -> ' + afterManual +
          ' (toast: ' + $('#toastMsg').textContent + '; average ready: ' + ($('#roLevel').textContent !== '—') + ')');
      }
      const immediateControls = {
        header: $('#btnCaptureStableMain').textContent,
        drawer: $('#btnCaptureStable').textContent,
        headerPressed: $('#btnCaptureStableMain').getAttribute('aria-pressed'),
        drawerPressed: $('#btnCaptureStable').getAttribute('aria-pressed')
      };

      try {
        await waitFor(() => $('#avgStateText').textContent === 'SETTLED', 'the steady signal to settle', 12000);
      } catch (err) {
        const state = $('#avgState');
        throw new Error(err.message + ' (state=' + state.dataset.state + ', text=' + $('#avgStateText').textContent +
          ', samples=' + state.dataset.samples + ', variance=' + state.dataset.variance +
          ', demo=' + !$('#chipDemo').classList.contains('hidden') + ', level=' + $('#roLevel').textContent + ')');
      }
      await wait(300);
      const finalCount = badge();
      if (finalCount !== before + 1) {
        throw new Error('cancelled wait captured a second trace: ' + before + ' -> ' + finalCount);
      }
      const finalControls = {
        header: $('#btnCaptureStableMain').textContent,
        drawer: $('#btnCaptureStable').textContent,
        headerPressed: $('#btnCaptureStableMain').getAttribute('aria-pressed'),
        drawerPressed: $('#btnCaptureStable').getAttribute('aria-pressed')
      };
      if (immediateControls.header !== 'When settled' ||
          immediateControls.drawer !== 'Capture when settled' ||
          immediateControls.headerPressed !== 'false' ||
          immediateControls.drawerPressed !== 'false' ||
          finalControls.header !== 'When settled' ||
          finalControls.drawer !== 'Capture when settled' ||
          finalControls.headerPressed !== 'false' ||
          finalControls.drawerPressed !== 'false') {
        throw new Error('header/drawer controls did not return to the unarmed state (immediate ' +
          JSON.stringify(immediateControls) + ', final ' + JSON.stringify(finalControls) + ')');
      }
      return {
        before,
        afterManual,
        finalCount,
        header: finalControls.header,
        drawer: finalControls.drawer
      };
    }.toString()) + ')()';

    const result = await app.evaluate(expression);
    console.log('ok   armed Capture when settled');
    console.log('ok   header and drawer showed the armed state');
    console.log('ok   Capture now incremented the trace count once: ' + result.before + ' -> ' + result.afterManual);
    console.log('ok   header and drawer returned to: ' + result.header + ' / ' + result.drawer);
    console.log('ok   steady signal settled without a second capture; final count ' + result.finalCount);
    console.log('PASS capture cancellation regression (' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's)');
  } finally {
    await app.close();
  }
}

runCaptureTest().catch((err) => {
  console.error('FAIL capture cancellation regression');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
