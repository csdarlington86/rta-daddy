'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

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

function startServer(root) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    if (!path.extname(rel)) rel += '.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
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

async function openApp({ root, urlPath, args = [], width = 1200, height = 800 }) {
  const server = await startServer(root);
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rta-headless-'));
  const browser = findBrowser();
  let child = null;
  let cdp = null;
  let session = null;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) {}
      try { cdp.ws.close(); } catch (e) {}
    }
    if (child) {
      try { child.kill(); } catch (e) {}
    }
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  };

  try {
    child = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      '--window-size=' + width + ',' + height,
      '--user-data-dir=' + profile,
      ...args,
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

    const browserWs = await waitForDevtools(child, 15000);
    cdp = await connect(browserWs);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    session = attached.sessionId;
    await cdp.send('Page.enable', {}, session);
    await cdp.send('Runtime.enable', {}, session);
    await cdp.send('Page.navigate', {
      url: 'http://127.0.0.1:' + port + urlPath
    }, session);

    for (let i = 0; i < 120; i++) {
      try {
        const ready = await evaluate(cdp, session,
          "document.readyState === 'complete' && !!document.querySelector('#topbar')");
        if (ready) break;
      } catch (e) { /* navigation may still be replacing the execution context */ }
      if (i === 119) throw new Error('App did not finish loading');
      await sleep(100);
    }

    return {
      cdp,
      session,
      evaluate: (expression) => evaluate(cdp, session, expression),
      close
    };
  } catch (err) {
    await close();
    throw err;
  }
}

module.exports = { openApp, sleep };
