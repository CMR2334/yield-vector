/**
 * auto-push.js — watches for file changes and auto-commits/pushes to GitHub
 *
 * Setup (one-time):
 *   1. cd /Users/collinrekowski/Automation/Churning
 *   2. git init
 *   3. git add index.html
 *   4. git commit -m "initial"
 *   5. Create a repo on github.com (e.g. "Churning"), then:
 *      git remote add origin https://github.com/YOUR_USERNAME/Churning.git
 *      git branch -M main
 *      git push -u origin main
 *   6. On GitHub: Settings → Pages → Source: "Deploy from a branch" → main / root
 *   7. npm install   (installs chokidar)
 *   8. node auto-push.js
 *
 * Your app will then live at: https://YOUR_USERNAME.github.io/Churning/
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
