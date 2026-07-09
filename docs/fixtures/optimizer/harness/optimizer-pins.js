// Optimizer engine Node harness.
// Mirrors the doc-corpus harness pattern: load the real app module, run the
// in-app pin function, and exit non-zero on any failed assertion.

const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const script = `
  import('./js/optimizer-engine.js')
    .then(({ testOptimizerPins }) => {
      const result = testOptimizerPins();
      process.exit(result.fail ? 1 : 0);
    })
    .catch(err => {
      console.error(err && err.stack ? err.stack : err);
      process.exit(1);
    });
`;

const result = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
  cwd: REPO,
  stdio: 'inherit'
});

process.exit(result.status == null ? 1 : result.status);
