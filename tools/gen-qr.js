/* Generates the printable QR code for the permanent app URL.
   Build-time tool only: the QR library lives in tools/qr and is never
   shipped to the app (build-dist.js only copies css/js/icons/html/sw/manifest).

   Usage: node tools/gen-qr.js [url]
*/
'use strict';
const fs = require('fs');
const path = require('path');

const URL_TO_ENCODE = process.argv[2] || 'https://site-60ea1d07501e4fd1a0d91f5bd0cc5293.freebuff.page/';

const QRCode = require(path.join(__dirname, 'qr', 'node_modules', 'qrcode'));

const outDir = path.join(__dirname, '..', 'qr');
fs.mkdirSync(outDir, { recursive: true });

/* The app icon doubles as the logo. Inlined so the printed sheet is one
   self-contained file with no broken images when it is printed elsewhere. */
const DARK_ICON = fs
  .readFileSync(path.join(__dirname, '..', 'icons', 'icon.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>\s*/, '')
  .trim();

/* Light, ink-friendly variant for paper: the dark plate becomes a white rounded
   square with a green outline, and the bars are inset so they clear that
   outline instead of running into it. Same silhouette, same greens, so it still
   reads as the app icon, but it prints as thin green strokes on white paper
   instead of a solid black block. Derived here rather than hand-drawn so it
   cannot drift away from icons/icon.svg. */
const LIGHT_ICON = (() => {
  const light = DARK_ICON
    .replace(
      '<rect width="512" height="512" rx="102" fill="#08080a"/>',
      '<rect x="6" y="6" width="500" height="500" rx="102" fill="#ffffff" stroke="#12b312" stroke-width="11"/>'
    )
    .replace('<g fill="#12b312">', '<g transform="translate(36 36) scale(0.86)" fill="#12b312">')
    .replace('<g fill="#5aeb5a">', '<g transform="translate(36 36) scale(0.86)" fill="#5aeb5a">');
  const insets = (light.match(/translate\(36 36\) scale\(0\.86\)/g) || []).length;
  if (insets !== 2 || !light.includes('stroke="#12b312"') || light.includes('#08080a')) {
    throw new Error('light logo rewrite failed: icons/icon.svg structure changed');
  }
  return light;
})();

/* High error correction (H ~30%) so the code still scans with a scuffed print,
   a phone camera at an angle, or a laser printer that dots badly. */
const ECC = 'H';
const MARGIN = 4; /* standard quiet zone, in modules */

(async () => {
  const svg = await QRCode.toString(URL_TO_ENCODE, {
    type: 'svg',
    errorCorrectionLevel: ECC,
    margin: MARGIN,
    color: { dark: '#000000ff', light: '#ffffffff' }
  });
  const svgPath = path.join(outDir, 'rta-daddy-qr.svg');
  fs.writeFileSync(svgPath, svg);

  /* the light logo is also useful on its own for other print work */
  const logoPath = path.join(outDir, 'rta-daddy-logo-light.svg');
  fs.writeFileSync(logoPath, LIGHT_ICON + '\n');

  const pngPath = path.join(outDir, 'rta-daddy-qr.png');
  await QRCode.toFile(pngPath, URL_TO_ENCODE, {
    type: 'png',
    errorCorrectionLevel: ECC,
    margin: MARGIN,
    width: 2048,
    color: { dark: '#000000ff', light: '#ffffffff' }
  });

  /* Printable A4 sheet: 85 mm code (big enough to scan across a room),
     name above, URL below in monospace so people can type it if they must. */
  /* modules = viewBox side minus the quiet zone on both sides */
  const vb = +(svg.match(/viewBox="0 0 (\d+)/) || [0, 0])[1];
  const modules = vb - MARGIN * 2;
  const sheet = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RTA Daddy — scan to open</title>
<style>
  @page { size: A4; margin: 18mm; }
  :root { --ink:#000; }
  * { box-sizing:border-box; }
  body {
    margin:0; font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink); background:#fff;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    min-height:100vh; text-align:center;
  }
  .brand { font-size:34pt; font-weight:300; letter-spacing:.02em; margin:0; }
  .brand span { font-weight:600; letter-spacing:.08em; font-size:20pt; vertical-align:middle; margin-left:8px; }
  .tag { font-size:12pt; color:#444; margin:3mm 0 9mm; }
  .code { width:85mm; height:85mm; }
  .code svg { width:100%; height:100%; display:block; }
  .logo { width:32mm; height:32mm; margin:0 auto 6mm; }
  .logo svg { width:100%; height:100%; display:block; }
  .free { font-size:15pt; font-weight:700; margin:3.5mm 0 0; }
  .hint { font-size:13pt; margin:9mm 0 3mm; }
  .url { font-family:ui-monospace,Consolas,monospace; font-size:9pt; color:#333; word-break:break-all; max-width:120mm; }
  .fine { font-size:8pt; color:#666; margin-top:10mm; }
</style>
</head>
<body>
  <div class="logo">${LIGHT_ICON}</div>
  <h1 class="brand">RTA<span>DADDY</span></h1>
  <p class="free">100% Free RTA and Spectrograph</p>
  <p class="tag">Real-time analyzer &mdash; runs in any browser, installs on Android</p>
  <div class="code">${svg.replace(/<\?xml[^>]*\?>\s*/, '')}</div>
  <p class="hint">Scan with your camera to open it</p>
  <p class="url">${URL_TO_ENCODE}</p>
  <p class="fine">No app store, no account. Microphone access needs HTTPS &mdash; this link provides it.</p>
</body>
</html>
`;
  const sheetPath = path.join(outDir, 'print.html');
  fs.writeFileSync(sheetPath, sheet);

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KiB';
  console.log('encoded : ' + URL_TO_ENCODE + '  (' + URL_TO_ENCODE.length + ' bytes)');
  console.log('ecc     : ' + ECC + ', ' + vb + ' modules incl. ' + MARGIN + '-module quiet zone (' + modules + 'x' + modules + ' code)');
  console.log('  ' + path.relative(path.join(__dirname, '..'), svgPath) + '  ' + kb(svgPath) + '  (vector, scales to any print size)');
  console.log('  ' + path.relative(path.join(__dirname, '..'), pngPath) + '  ' + kb(pngPath) + '  2048x2048');
  console.log('  ' + path.relative(path.join(__dirname, '..'), logoPath) + '  ' + kb(logoPath) + '  (light logo, white plate for print)');
  console.log('  ' + path.relative(path.join(__dirname, '..'), sheetPath) + '  ' + kb(sheetPath) + '  (A4 print sheet, 85mm code, light logo)');
})().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1); });
