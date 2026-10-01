import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { currentTarget } from './targets.mjs';
import { npmCommand } from './npm-command.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert(process.env.SYSINFO_ELECTRON_EXECUTABLE, 'Set SYSINFO_ELECTRON_EXECUTABLE to the real Electron executable');
const asar = require(process.env.SYSINFO_ASAR_MODULE || '@electron/asar');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'artifacts/local/manifest.json'), 'utf8'));
const target = currentTarget();
const binding = manifest.packages.find(item => item.name === `${pkg.name}-${target.suffix}`);
const main = manifest.packages.find(item => item.name === pkg.name);
assert(binding && main, 'Run yarn check:packages --local first');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sysinfo-asar-'));
try {
  const app = path.join(directory, 'app');
  await fs.mkdir(app, { recursive: true });
  const release = path.join(root, 'artifacts/local');
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'sysinfo-asar-fixture', version: '1.0.0', main: 'main.cjs', dependencies: {
    [main.name]: `file:${path.join(release, main.filename).replaceAll('\\', '/')}`,
    [binding.name]: `file:${path.join(release, binding.filename).replaceAll('\\', '/')}`,
  } }));
  npmCommand(['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], app);
  await fs.writeFile(path.join(app, 'main.cjs'), `
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { queryProcesses, SysInfo } = require(${JSON.stringify(pkg.name)});
app.whenReady().then(async () => {
  const rows = await queryProcesses(10000);
  const row = rows.find(r => r.pid === process.pid);
  assert(row);
  assert.equal(row.parentPid, Number(process.env.SYSINFO_PARENT_PID));
  assert.equal(typeof row.startTime, 'bigint');
  assert.equal(typeof SysInfo.prototype.refreshMemory, 'function');
  fs.writeFileSync(process.env.SYSINFO_ASAR_REPORT, JSON.stringify({
    platform: process.platform, electron: process.versions.electron, node: process.version,
    asar: true, optionalPlatformBinding: true, selfPidVerified: true,
  }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
  const archive = path.join(directory, 'app.asar');
  await asar.createPackageWithOptions(app, archive, { unpack: '**/*.node' });
  await fs.access(path.join(archive + '.unpacked', 'node_modules', binding.name, `sysinfo.${target.suffix}.node`));
  assert(!asar.listPackage(archive).some(file => file.endsWith('.rs')));
  const report = process.env.SYSINFO_ASAR_REPORT || path.join(root, 'test-results', 'integration-electron-asar.json');
  await fs.mkdir(path.dirname(report), { recursive: true });
  const env = { ...process.env, SYSINFO_PARENT_PID: String(process.pid), SYSINFO_ASAR_REPORT: report };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(process.env.SYSINFO_ELECTRON_EXECUTABLE, [archive, '--disable-gpu', '--no-sandbox'], {
    env, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  if (run.error || run.status !== 0) { throw run.error || new Error((run.stderr || run.stdout).slice(0,4000)); }
  console.log(await fs.readFile(report, 'utf8'));
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  await fs.rm(directory, { recursive: true, force: true });
}
