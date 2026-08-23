// Optimizer engine Node harness.
// Mirrors the doc-corpus harness pattern: load the real app module, run the
// in-app pin function, and exit non-zero on any failed assertion.

const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
// Two in-app pin suites run here: the optimizer engine's own, and (2026-08-23)
// the entity/email catalog migration in migrations-catalogs.js. The catalog
// pins live outside optimizer-engine deliberately — that module's contract is
// "no App/Sync/render imports" — but they are the same kind of bare-node
// assertion, so the release battery stays a single command.
const script = `
  Promise.all([import('./js/optimizer-engine.js'), import('./js/migrations-catalogs.js')])
    .then(([opt, cat]) => {
      const a = opt.testOptimizerPins();
      const b = cat.testEntityCatalogPins();
      process.exit((a.fail || b.fail) ? 1 : 0);
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
