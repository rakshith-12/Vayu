import * as esbuild from 'esbuild';
import { spawnSync } from 'child_process';
import * as path from 'path';

console.log('[tests] Bundling test suites with esbuild (aliasing vscode to mock)...');
esbuild.buildSync({
  entryPoints: [
    'tests/mvp.test.mjs',
    'tests/task_a_e2e.test.mjs',
    'tests/all_tasks_verification.test.mjs',
  ],
  bundle: true,
  outdir: 'dist/tests',
  platform: 'node',
  format: 'cjs',
  alias: {
    vscode: path.resolve('tests/mock-vscode.js'),
  },
});

console.log('[tests] Executing tests via node:test...');
const res = spawnSync(
  process.execPath,
  [
    '--test',
    'dist/tests/mvp.test.js',
    'dist/tests/task_a_e2e.test.js',
    'dist/tests/all_tasks_verification.test.js',
  ],
  {
    stdio: 'inherit',
  },
);

if (res.status !== 0) {
  process.exit(res.status ?? 1);
}
