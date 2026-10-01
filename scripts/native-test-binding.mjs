import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { currentTarget } from './targets.mjs';

// Instrument the addon before loading the public entry point. This test-only
// helper works with both source builds and isolated platform-package installs.
export function countNativeQueries(packageRoot) {
  const require = createRequire(path.join(packageRoot, 'package.json'));
  const pkg = require('./package.json');
  const suffix = currentTarget().suffix;
  const local = path.join(packageRoot, `sysinfo.${suffix}.node`);
  const native = require(fs.existsSync(local) ? local : `${pkg.name}-${suffix}`);
  const original = native.queryProcesses;
  let calls = 0;
  native.queryProcesses = budget => { calls++; return original(budget); };
  return { get calls() { return calls; }, restore() { native.queryProcesses = original; } };
}
