#!/usr/bin/env node
/* Regression test: arm Capture when settled, capture now, and verify the wait
   is cancelled before the signal settles. Runs the real app in a headless
   Chrome/Edge with a synthetic steady microphone, so it needs no package
   install and never touches the user's browser profile. */
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    if (!path.extname(rel)) rel += '.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function browserCandidates() {
  const list = [process.env.CHROME_PATH, process.env.EDGE_PATH];
  if (process.platform === 'win32') {
    for (const base of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      list.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    list.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return list.filter(Boolean);
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const command of ['google-chrome', 'chromium', 'chromium-browser', 'msedge']) {
    const found = spawnSync(command, ['--version'], { stdio: 'ignore' });
    if (found.status === 0) return command;
  }
  throw new Error('Chrome or Edge was not found. Set CHROME_PATH to a Chromium-based browser.');
}

function waitForDevtools(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the browser DevTools endpoint')), timeoutMs);
    const finish = (fn, value) => {
      clearTimeout(timer);
      child.stderr.removeListener('data', onData);
      child.removeListener('exit', onExit);
      fn(value);
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(resolve, match[1]);
    };
    const onExit = (code) => finish(reject, new Error('Browser exited before DevTools was ready (code ' + code + ')'));
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 0;
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const id = ++nextId;
      pending.set(id, { res, rej });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      ws.send(JSON.stringify(message));
    });
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (e) { return; }
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.rej(new Error(message.error.message || 'DevTools error'));
      else item.res(message.result);
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => resolve({ ws, send }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || 'Page evaluation failed');
  }
  return result.result.value;
}

async function runCaptureTest() {
  const startedAt = Date.now();
  const server = await startServer();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rta-capture-test-'));
  const browser = findBrowser();
  let child = null;
  let cdp = null;
  let pageSession = null;
  try {
    child = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=0',
      '--window-size=1200,800',
      '--user-data-dir=' + profile,
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

    const browserWs = await waitForDevtools(child, 15000);
    cdp = await connect(browserWs);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    pageSession = attached.sessionId;
    await cdp.send('Page.enable', {}, pageSession);
    await cdp.send('Runtime.enable', {}, pageSession);

    const appUrl = 'http://127.0.0.1:' + port + '/app?demo=1&captureTest=1';
    await cdp.send('Page.navigate', { url: appUrl }, pageSession);
    for (let i = 0; i < 120; i++) {
      try {
        const ready = await evaluate(cdp, pageSession,
          "document.readyState === 'complete' && !!document.querySelector('#btnStart')");
        if (ready) break;
      } catch (e) { /* navigation may still be replacing the execution context */ }
      if (i === 119) throw new Error('App did not finish loading');
      await sleep(100);
    }

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

    const result = await evaluate(cdp, pageSession, expression);
    console.log('ok   armed Capture when settled');
    console.log('ok   header and drawer showed the armed state');
    console.log('ok   Capture now incremented the trace count once: ' + result.before + ' -> ' + result.afterManual);
    console.log('ok   header and drawer returned to: ' + result.header + ' / ' + result.drawer);
    console.log('ok   steady signal settled without a second capture; final count ' + result.finalCount);
    console.log('PASS capture cancellation regression (' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's)');
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) {}
      try { cdp.ws.close(); } catch (e) {}
    }
    if (child) {
      try { child.kill(); } catch (e) {}
    }
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

runCaptureTest().catch((err) => {
  console.error('FAIL capture cancellation regression');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
