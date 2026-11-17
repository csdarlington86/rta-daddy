#!/usr/bin/env node
'use strict';

const path = require('path');
const { openApp } = require('./lib/headless');

const ROOT = path.resolve(__dirname, '..');

function bootExpression({ bucket, expectedLabel, value, returnMode }) {
  return `(() => {
    const key = 'rtapro.settings.v1';
    const read = () => JSON.parse(localStorage.getItem(key) || '{}');
    const has = (obj, id) => Object.prototype.hasOwnProperty.call(obj || {}, id);
    const stored = read();
    if (stored.trimChannelsVersion !== 2) throw new Error('trim migration marker missing');
    if (!stored.${bucket} || stored.${bucket}['legacy-mic'] !== ${value}) throw new Error('legacy trim was not moved to ${bucket}');
    if (has(stored.trims, 'legacy-mic')) throw new Error('legacy trim stayed in the left bucket');
    const label = document.querySelector('#trimLabelA');
    if (!label || label.textContent !== ${JSON.stringify(expectedLabel)}) throw new Error('unexpected trim label: ' + (label && label.textContent));
    const slider = document.querySelector('#trimRowA input[data-setting="trim"]');
    if (!slider || Number(slider.value) !== ${value}) throw new Error('legacy trim reset at boot');
    document.querySelector('[data-seg="chan"] [data-value="L"]').click();
    if (Number(slider.value) !== 0) throw new Error('legacy trim became a left trim');
    document.querySelector('[data-seg="chan"] [data-value="${returnMode}"]').click();
    if (Number(slider.value) !== ${value}) throw new Error('trim did not return in its original mode');
    const final = read();
    if (!final.${bucket} || final.${bucket}['legacy-mic'] !== ${value}) throw new Error('migrated trim was not persisted');
    if (has(final.trims, 'legacy-mic')) throw new Error('left bucket gained the legacy trim');
    return { bucket: ${JSON.stringify(bucket)}, value: final.${bucket}['legacy-mic'], marker: final.trimChannelsVersion };
  })()`;
}

function leftPreservedExpression(value) {
  return `(() => {
    const key = 'rtapro.settings.v1';
    const read = () => JSON.parse(localStorage.getItem(key) || '{}');
    const has = (obj, id) => Object.prototype.hasOwnProperty.call(obj || {}, id);
    const check = (state) => {
      if (!state.trims || state.trims['legacy-mic'] !== ${value}) throw new Error('legacy Left trim left the left bucket');
      if (has(state.trimsB, 'legacy-mic')) throw new Error('legacy Left trim moved to the right bucket');
      if (has(state.trimsM, 'legacy-mic')) throw new Error('legacy Left trim moved to the mix bucket');
    };
    const stored = read();
    if (stored.trimChannelsVersion !== 2) throw new Error('trim migration marker missing');
    check(stored);
    const label = document.querySelector('#trimLabelA');
    if (!label || label.textContent !== 'Left channel trim') throw new Error('Left-mode label changed: ' + (label && label.textContent));
    const slider = document.querySelector('#trimRowA input[data-setting="trim"]');
    if (!slider || Number(slider.value) !== ${value}) throw new Error('legacy Left trim reset at boot');
    document.querySelector('[data-seg="chan"] [data-value="R"]').click();
    if (Number(slider.value) !== 0) throw new Error('legacy Left trim appeared on the right');
    document.querySelector('[data-seg="chan"] [data-value="L"]').click();
    if (Number(slider.value) !== ${value}) throw new Error('legacy Left trim did not return');
    const final = read();
    check(final);
    if (final.trimChannelsVersion !== 2) throw new Error('trim migration marker was lost');
    return { bucket: 'trims', value: final.trims['legacy-mic'], marker: final.trimChannelsVersion };
  })()`;
}

function dualFallbackExpression() {
  return `(() => {
    const key = 'rtapro.settings.v1';
    const read = () => JSON.parse(localStorage.getItem(key) || '{}');
    const stored = read();
    if (stored.trimChannelsVersion !== 2) throw new Error('trim migration marker missing');
    if (!stored.trims || stored.trims['legacy-mic'] !== 3) throw new Error('legacy dual left trim was not preserved from the active lane');
    if (!stored.trimsB || stored.trimsB['legacy-mic'] !== 2) throw new Error('legacy dual right trim was not preserved from the active lane');
    const a = document.querySelector('#trimRowA input[data-setting="trim"]');
    const b = document.querySelector('#trimRowB input[data-setting="trimB"]');
    if (!a || Number(a.value) !== 3) throw new Error('dual left trim reset at boot');
    if (!b || Number(b.value) !== 2) throw new Error('dual right trim reset at boot');
    return { left: stored.trims['legacy-mic'], right: stored.trimsB['legacy-mic'], marker: stored.trimChannelsVersion };
  })()`;
}

function reloadMarkerExpression() {
  return `(() => {
    const stored = JSON.parse(localStorage.getItem('rtapro.settings.v1') || '{}');
    if (stored.trimChannelsVersion !== 2) throw new Error('trim migration marker did not survive reload');
    if (!stored.trimsB || stored.trimsB['legacy-mic'] !== 7) throw new Error('migrated right trim did not survive reload');
    if (Object.prototype.hasOwnProperty.call(stored.trims || {}, 'legacy-mic')) throw new Error('left bucket gained the migrated trim after reload');
    const slider = document.querySelector('#trimRowA input[data-setting="trim"]');
    if (!slider || Number(slider.value) !== 7) throw new Error('right trim reset after reload');
    return { marker: stored.trimChannelsVersion, right: stored.trimsB['legacy-mic'] };
  })()`;
}

function currentPreservedExpression() {
  return `(() => {
    const key = 'rtapro.settings.v1';
    const read = () => JSON.parse(localStorage.getItem(key) || '{}');
    const check = (state) => {
      if (!state.trims || state.trims['legacy-mic'] !== 4) throw new Error('channel-aware left trim changed');
      if (!state.trimsB || state.trimsB['legacy-mic'] !== 2) throw new Error('channel-aware right trim changed');
      if (!state.trimsM || state.trimsM['legacy-mic'] !== 1) throw new Error('channel-aware mix trim changed');
    };
    const stored = read();
    if (stored.trimChannelsVersion !== 2) throw new Error('trim migration marker missing');
    check(stored);
    const slider = document.querySelector('#trimRowA input[data-setting="trim"]');
    if (!slider || Number(slider.value) !== 2) throw new Error('Right-mode boot did not use the right bucket');
    document.querySelector('[data-seg="chan"] [data-value="L"]').click();
    if (Number(slider.value) !== 4) throw new Error('Left mode did not use the left bucket');
    document.querySelector('[data-seg="chan"] [data-value="mix"]').click();
    if (Number(slider.value) !== 1) throw new Error('Mix mode did not use the mix bucket');
    document.querySelector('[data-seg="chan"] [data-value="R"]').click();
    if (Number(slider.value) !== 2) throw new Error('Right mode did not return to the right bucket');
    const final = read();
    check(final);
    if (final.trimChannelsVersion !== 2) throw new Error('trim migration marker was lost');
    return { left: final.trims['legacy-mic'], right: final.trimsB['legacy-mic'], mix: final.trimsM['legacy-mic'] };
  })()`;
}

async function bootSeeded(settings, expression, reloadExpression) {
  const seed = JSON.stringify(settings);
  const app = await openApp({
    root: ROOT,
    urlPath: '/app',
    initScript: `if (!sessionStorage.getItem('rtaTrimSeed')) {
      sessionStorage.setItem('rtaTrimSeed', '1');
      localStorage.setItem('rtapro.settings.v1', ${JSON.stringify(seed)});
    }`
  });
  try {
    const result = await app.evaluate(expression);
    if (reloadExpression) {
      await app.reload();
      result.afterReload = await app.evaluate(reloadExpression);
    }
    return result;
  } finally {
    await app.close();
  }
}

async function run() {
  const base = {
    calVersion: 2,
    uiMode: 'advanced',
    micId: 'legacy-mic',
    trimB: 0,
    trimsB: {}
  };

  const right = await bootSeeded({
    ...base,
    chanMode: 'R',
    trim: 7,
    trims: { 'legacy-mic': 7 },
    trimsB: { 'legacy-mic': 2 }
  }, bootExpression({ bucket: 'trimsB', expectedLabel: 'Right channel trim', value: 7, returnMode: 'R' }), reloadMarkerExpression());
  console.log('ok   legacy Right-mode trim moved to the right bucket, survived a Left/Right round-trip, and stayed migrated after reload');

  const mix = await bootSeeded({
    ...base,
    chanMode: 'mix',
    trim: 5,
    trims: { 'legacy-mic': 5 }
  }, bootExpression({ bucket: 'trimsM', expectedLabel: 'Mix trim', value: 5, returnMode: 'mix' }));
  console.log('ok   legacy Mix trim moved to the mix bucket and survived a Left/Mix round-trip');

  const left = await bootSeeded({
    ...base,
    chanMode: 'L',
    trim: 4,
    trims: { 'legacy-mic': 4 }
  }, leftPreservedExpression(4));
  console.log('ok   legacy Left-mode trim stayed in the left bucket');

  const leftFallback = await bootSeeded({
    ...base,
    chanMode: 'L',
    trim: 6,
    trims: {}
  }, leftPreservedExpression(6));
  console.log('ok   legacy Left trim kept its transient value when the bucket was missing');

  const rightFallback = await bootSeeded({
    ...base,
    chanMode: 'R',
    trim: 6,
    trims: {}
  }, bootExpression({ bucket: 'trimsB', expectedLabel: 'Right channel trim', value: 6, returnMode: 'R' }));
  console.log('ok   legacy Right trim kept its transient value when the bucket was missing');

  const rightZeroFallback = await bootSeeded({
    ...base,
    chanMode: 'R',
    trim: 6,
    trims: {},
    trimsB: { 'legacy-mic': 0 }
  }, bootExpression({ bucket: 'trimsB', expectedLabel: 'Right channel trim', value: 6, returnMode: 'R' }));
  console.log('ok   a default-zero right bucket did not mask the active transient trim');

  const dualFallback = await bootSeeded({
    ...base,
    chanMode: 'dual',
    trim: 3,
    trimB: 2,
    trims: {},
    trimsB: {}
  }, dualFallbackExpression());
  console.log('ok   legacy dual trims kept both transient lane values');

  const staleMarker = await bootSeeded({
    ...base,
    trimChannelsVersion: 2,
    chanMode: 'R',
    trim: 7,
    trims: { 'legacy-mic': 7 },
    trimsB: { 'legacy-mic': 2 }
  }, bootExpression({ bucket: 'trimsB', expectedLabel: 'Right channel trim', value: 7, returnMode: 'R' }));
  console.log('ok   a stale marker without channel-aware buckets did not prevent migration');

  const current = await bootSeeded({
    ...base,
    chanMode: 'R',
    trim: 2,
    trims: { 'legacy-mic': 4 },
    trimsB: { 'legacy-mic': 2 },
    trimsM: { 'legacy-mic': 1 }
  }, currentPreservedExpression());
  console.log('ok   channel-aware trims with trimsM but no marker were not migrated');

  console.log('PASS trim migration regression ' + JSON.stringify({ right, mix, left, leftFallback, rightFallback, rightZeroFallback, dualFallback, staleMarker, current }));
}

run().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
