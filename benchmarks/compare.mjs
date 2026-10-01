import { countNativeQueries } from '../scripts/native-test-binding.mjs';
import { queryCimProcesses } from './cim.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counter = countNativeQueries(root);
const { queryProcesses } = require(root);
const windows = process.platform === 'win32';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sysinfo-benchmark-'));
const fixtureNode = process.env.SYSINFO_BENCHMARK_NODE || process.execPath;
const executable = fixtureNode;
const fixture = path.join(directory, 'fixture 中文.cjs');
fs.writeFileSync(fixture, "process.stdout.write('ready'); setInterval(() => {}, 1000);\n");
const argv = [fixture, 'argument with spaces 中文', 'quote=a"b', '', 'trailing\\'];
const child = spawn(executable, argv, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const samples = { native: [], cim: [] };
const canonical = value => {
  const real = fs.realpathSync(value);
  return windows ? real.toLowerCase() : real;
};
function verify(kind, rows) {
  const row = rows.find(item => item.pid === child.pid);
  assert(row, 'Fixture missing from snapshot');
  assert.equal(row.parentPid, process.pid);
  assert.equal(canonical(row.exe), canonical(executable));
  assert.deepEqual(row.cmd.slice(1), argv);
  if (kind === 'native') {
    assert.equal(canonical(row.cwd), canonical(directory));
    assert.equal(typeof row.startTime, 'bigint');
    assert(row.startTime > 0n);
  }
}
async function measure(kind) {
  const started = performance.now();
  const rows = kind === 'native'
    ? await queryProcesses(10000)
    : await queryCimProcesses(10000);
  const elapsedMs = performance.now() - started;
  verify(kind, rows);
  samples[kind].push({ elapsedMs, rows: rows.length, argvUnavailable: rows.filter(row => !Array.isArray(row.cmd)).length, fixtureVerified: true });
}
const round = value => Math.round(value * 10) / 10;
function stats(items) {
  const values = items.map(item => item.elapsedMs).sort((a, b) => a - b);
  return {
    count: items.length, firstMs: round(items[0].elapsedMs),
    p50Ms: round(values[Math.ceil(values.length * .5) - 1]),
    p95Ms: round(values[Math.ceil(values.length * .95) - 1]), maxMs: round(values.at(-1)),
    within1000Ms: values.filter(value => value <= 1000).length,
    metadataVerified: items.filter(item => item.fixtureVerified).length,
    rowsMin: Math.min(...items.map(item => item.rows)), rowsMax: Math.max(...items.map(item => item.rows)),
  };
}
let timer;
try {
  await Promise.race([
    once(child.stdout, 'data'), once(child, 'error').then(([error]) => { throw error; }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture not ready')), 10000); }),
  ]);
  clearTimeout(timer);
  for (let i = 0; i < 30; i++) {
    if (windows && i % 2) { await measure('cim'); await measure('native'); }
    else { await measure('native'); if (windows) { await measure('cim'); } }
    if ((i + 1) % 10 === 0) { console.log(JSON.stringify({ progress: i + 1, total: 30 })); }
  }
  const callsBeforeBurst = counter.calls;
  const burst = await Promise.all(Array.from({ length: 20 }, () => queryProcesses(1000)));
  assert.equal(counter.calls - callsBeforeBurst, 1);
  for (const snapshot of burst) { verify('native', snapshot); }
  let success = 0;
  for (let i = 0; i < 10; i++) { verify('native', await queryProcesses(1000)); success++; }
  const callsBeforeDeadline = counter.calls;
  const shortStarted = performance.now();
  const short = queryProcesses(10).then(() => ({ outcome: 'completed' }), error => {
    assert.equal(error.code, 'ERR_PROCESS_QUERY_TIMEOUT');
    return { outcome: 'timeout', elapsedMs: performance.now() - shortStarted };
  });
  const longer = queryProcesses(1000);
  const shortResult = await short;
  verify('native', await longer);
  assert.equal(counter.calls - callsBeforeDeadline, 1);
  const report = {
    protocol: 'all-processes-v1', date: new Date().toISOString(), packageVersion: require('../package.json').version,
    platform: process.platform, arch: process.arch, osRelease: os.release(),
    runtime: process.versions.electron ? 'Electron' : 'Node', node: process.version,
    electron: process.versions.electron || null, samplesPerBackend: 30, queryBudgetMs: 10000,
    native: stats(samples.native), cim: windows ? stats(samples.cim) : null, samples,
    burst: { requests: 20, nativeQueries: 1 }, deadline: { requests: 10, budgetMs: 1000, success },
    independentDeadlines: { short: shortResult, longerSucceeded: true, sharedNativeScans: 1 },
    scope: 'Both backends enumerate all processes without application filtering. CIM includes fresh PowerShell startup, JSON transport and argv parsing; native additionally exposes cwd and startTime. Only dedicated fixture metadata is checked. No CPU or memory comparison. First run included; no reboot cold-start claim.',
  };
  const output = process.env.SYSINFO_BENCHMARK_REPORT || path.join(root, 'test-results', `benchmark-${process.platform}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, native: report.native, cim: report.cim, independentDeadlines: report.independentDeadlines }));
} finally {
  counter.restore();
  clearTimeout(timer);
  child.kill();
  if (child.pid && child.exitCode === null && child.signalCode === null) { await once(child, 'exit'); }
  assert(path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
}
