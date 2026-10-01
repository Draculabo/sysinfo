import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentTarget, targets } from './targets.mjs';
import { npmCommand } from './npm-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'artifacts', process.argv.includes('--local') ? 'local' : 'release');
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = manifest.packages.find(item => item.name === pkg.name);
const binding = manifest.packages.find(item => item.name === `${pkg.name}-${currentTarget().suffix}`);
assert(main && binding, 'Both host platform and main tarballs are required');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sysinfo-install-'));
try {
  // Other platform versions may not be published yet. Install only the prepared host
  // binding explicitly; the untouched main manifest still declares every optional target.
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, dependencies: {
    [main.name]: `file:${path.join(release, main.filename).replaceAll('\\', '/')}`,
    [binding.name]: `file:${path.join(release, binding.filename).replaceAll('\\', '/')}`,
  } }));
  npmCommand(['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], directory);
  const packageRoot = path.join(directory, 'node_modules', pkg.name);
  const installedManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.deepEqual(installedManifest.optionalDependencies,
    Object.fromEntries(targets.map(target => [`${pkg.name}-${target.suffix}`, pkg.version])));
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(installedManifest.scripts?.[lifecycle], undefined, 'Consumers must load prebuilt bindings without a build lifecycle');
  }
  assert(!fs.existsSync(path.join(packageRoot, `sysinfo.${currentTarget().suffix}.node`)), 'Loader must use optional platform package');
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/test-processes.mjs')], {
    cwd: directory, env: { ...process.env, SYSINFO_PACKAGE_ROOT: packageRoot },
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  if (run.error || run.status !== 0) { throw run.error || new Error((run.stderr || run.stdout).slice(0,4000)); }
  console.log(run.stdout.trim());
  npmCommand(['ci', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], directory);
  console.log(JSON.stringify({ cleanTarballInstall: true, cleanNpmCi: true, nativeOptionalPackage: binding.name, rustRequired: false }));
} finally {
  assert(path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
}
