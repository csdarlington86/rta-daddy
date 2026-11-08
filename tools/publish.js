#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.chdir(root);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const help = args.includes('--help') || args.includes('-h');
const message = args.filter((arg) => !arg.startsWith('-')).join(' ').trim()
  || `Publish RTA Daddy update ${new Date().toISOString().slice(0, 10)}`;

if (help) {
  console.log('Usage: node tools/publish.js [--dry-run] ["commit message"]');
  process.exit(0);
}

function run(command, commandArgs) {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`);
  execFileSync(command, commandArgs, { stdio: 'inherit' });
}

function capture(command, commandArgs) {
  return execFileSync(command, commandArgs, { encoding: 'utf8' }).trim();
}

function fail(text) {
  console.error(`\nERROR: ${text}`);
  process.exit(1);
}

if (capture('git', ['rev-parse', '--is-inside-work-tree']) !== 'true') {
  fail('Run this from inside the RTA Daddy Git repository.');
}

const branch = capture('git', ['branch', '--show-current']);
if (branch !== 'master') {
  fail(`Current branch is "${branch}"; publish only from "master".`);
}

for (const remote of ['github', 'origin']) {
  try {
    capture('git', ['remote', 'get-url', remote]);
  } catch {
    fail(`Remote "${remote}" is not configured.`);
  }
}

const originUrl = capture('git', ['remote', 'get-url', 'origin']);
if (/^[A-Za-z]:[\\/]/.test(originUrl) && !fs.existsSync(originUrl)) {
  fail(`The external-drive remote is unavailable: ${originUrl}`);
}

const pending = capture('git', ['status', '--short']);
if (pending) {
  console.log('\nChanges to publish:');
  console.log(pending);
} else {
  console.log('\nNo working-tree changes before the build.');
}

console.log('\nChecking JavaScript...');
run('node', ['--check', 'js/app.js']);
run('node', ['--check', 'sw.js']);
run('node', ['--check', 'deploy/worker.js']);

console.log('\nRebuilding deploy/dist...');
run('node', ['tools/build-dist.js']);

if (dryRun) {
  console.log('\nDry run complete: nothing was staged, committed, or pushed.');
  process.exit(0);
}

run('git', ['add', '-A']);
const staged = capture('git', ['diff', '--cached', '--name-only']);
if (staged) {
  console.log('\nStaged files:');
  console.log(staged);
  run('git', ['commit', '-m', message]);
} else {
  console.log('\nNo changes to commit; the build is already committed.');
}

let pushFailed = false;
for (const remote of ['github', 'origin']) {
  try {
    run('git', ['push', remote, 'master']);
  } catch {
    pushFailed = true;
    console.error(`\nPush to "${remote}" failed.`);
  }
}

const local = capture('git', ['rev-parse', 'HEAD']);
console.log('\nVerification:');
console.log(`local:  ${local}`);

for (const remote of ['github', 'origin']) {
  try {
    const refs = capture('git', ['ls-remote', remote, 'refs/heads/master']);
    const sha = refs.split(/\s+/)[0];
    console.log(`${remote}: ${sha}`);
    if (sha !== local) pushFailed = true;
  } catch {
    pushFailed = true;
    console.error(`${remote}: unable to verify`);
  }
}

if (pushFailed) {
  fail('At least one backup is not at the local commit. Fix the remote and rerun.');
}

console.log('\nBoth GitHub and the external drive are up to date.');
console.log('The live site was not deployed. Publish deploy/manifest.json through Freebuff Sites when ready.');
