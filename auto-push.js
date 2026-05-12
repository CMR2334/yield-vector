/**
 * auto-push.js — watches index.html and auto-commits/pushes to GitHub on save.
 *
 * Repo:     https://github.com/CMR2334/yield-vector
 * Live URL: https://CMR2334.github.io/yield-vector/
 *
 * Usage:
 *   node auto-push.js
 *
 * Requires: gh auth done, remote set, Pages enabled on main/root.
 */

const chokidar = require('chokidar');
const { execSync } = require('child_process');
const path = require('path');

const REPO_DIR = __dirname;
const DEBOUNCE_MS = 3000;

let timer = null;

function push() {
  try {
    execSync('git add index.html', { cwd: REPO_DIR, stdio: 'inherit' });
    execSync('git commit -m "auto update" --allow-empty', { cwd: REPO_DIR, stdio: 'inherit' });
    execSync('git push', { cwd: REPO_DIR, stdio: 'inherit' });
    console.log(`[${new Date().toLocaleTimeString()}] Pushed to GitHub`);
  } catch (err) {
    console.error(`Push failed:`, err.message);
  }
}

const watcher = chokidar.watch(path.join(REPO_DIR, 'index.html'), {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
});

watcher.on('change', () => {
  console.log(`[${new Date().toLocaleTimeString()}] Change detected — pushing in ${DEBOUNCE_MS / 1000}s...`);
  clearTimeout(timer);
  timer = setTimeout(push, DEBOUNCE_MS);
});

console.log('Watching index.html for changes. Ctrl+C to stop.');
