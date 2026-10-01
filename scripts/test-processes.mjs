import { countNativeQueries } from './native-test-binding.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Consumers can run the exact same metadata assertions against an installed tarball.
const packageRoot = process.env.SYSINFO_PACKAGE_ROOT || root;
const counter = countNativeQueries(packageRoot);
const { queryProcesses, SysInfo, Cpu, cpuFeatures } = require(packageRoot);
const esm = await import(pathToFileURL(path.join(packageRoot, 'index.js')));
assert.equal(esm.queryProcesses, queryProcesses);
assert.equal(esm.SysInfo, SysInfo);
assert.equal(typeof Cpu, 'function');
assert.equal(typeof cpuFeatures, 'function');
assert.equal(typeof SysInfo.prototype.refreshMemory, 'function');
assert.equal(typeof SysInfo.prototype.systemName, 'function');
const system = new SysInfo();
system.refreshMemory();
assert.equal(typeof system.totalMemory(), 'bigint');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sysinfo-process-'));
const fixture = path.join(directory, 'query fixture 中文.cjs');
fs.writeFileSync(fixture, "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);\n");
const argumentsToCheck = ['argument with spaces 中文', 'quote=a"b', '', '', 'trailing\\', ''];
const child = spawn(process.execPath, [fixture, ...argumentsToCheck], {
  cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: { ...process.env, SYSINFO_ARGV_SENTINEL: 'must-not-be-an-argument' },
});
let timer;
try {
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'error').then(([error]) => { throw error; }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture did not start')), 10000); }),
  ]);
  clearTimeout(timer);
  const started = performance.now();
  const rows = await queryProcesses(10000);
  const elapsedMs = performance.now() - started;
  const current = rows.find(row => row.pid === child.pid);
  assert(current, 'The real fixture process must be observable');
  assert.equal(current.parentPid, process.pid);
  const expectedArguments = [fixture, ...argumentsToCheck];
  if (process.platform === 'linux') {
    // QEMU exposes the host interpreter for another PID, even when that path is absent here.
    const processDirectory = `/proc/${child.pid}`;
    assert.equal(current.exe, fs.readlinkSync(`${processDirectory}/exe`));
    const bytes = fs.readFileSync(`${processDirectory}/cmdline`);
    assert.equal(bytes.at(-1), 0, 'The live fixture argv must end in NUL');
    const kernelArguments = bytes.subarray(0, -1).toString('utf8').split('\0');
    assert.deepEqual(current.cmd, kernelArguments);
    assert.deepEqual(current.cmd.slice(-expectedArguments.length), expectedArguments);
  } else {
    assert.equal(fs.realpathSync(current.exe), fs.realpathSync(process.execPath));
    assert.deepEqual(current.cmd.slice(1), expectedArguments);
  }
  assert.equal(fs.realpathSync(current.cwd), fs.realpathSync(directory));
  assert.equal(typeof current.startTime, 'bigint');
  assert(current.startTime > 0n);
  await assert.rejects(queryProcesses(0), { code: 'ERR_PROCESS_QUERY_INVALID_TIMEOUT' });

  const callsBefore = counter.calls;
  const burst = await Promise.all(Array.from({ length: 20 }, () => queryProcesses(1000)));
  const nativeCalls = counter.calls - callsBefore;
  assert.equal(nativeCalls, 1);
  for (const snapshot of burst) { assert(snapshot.some(row => row.pid === child.pid)); }
  const report = {
    platform: process.platform, arch: process.arch, node: process.version,
    electron: process.versions.electron || null, elapsedMs: Math.round(elapsedMs),
    argvPreserved: true, parentVerified: true, cwdVerified: true, startTimeVerified: true,
    upstreamMethodsPreserved: true, esmAndCjs: true, burst: { requests: 20, nativeScans: nativeCalls },
  };
  if (process.env.SYSINFO_REPORT_PATH) { fs.writeFileSync(process.env.SYSINFO_REPORT_PATH, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report));
} finally {
  counter.restore();
  clearTimeout(timer);
  child.kill();
  if (child.exitCode === null && child.signalCode === null && child.pid) { await once(child, 'exit'); }
  assert(path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
}
