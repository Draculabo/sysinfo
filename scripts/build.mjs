import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { currentTarget, targets } from './targets.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debug = process.argv.includes('--debug');
const args = process.argv.slice(2).filter(arg => arg !== '--debug');
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? targets.find(t => t.triple === args[targetIndex + 1]) : currentTarget();
assert(target, 'Build target must be in the upstream matrix');
const publicFiles = ['index.js', 'index.d.ts', 'Cargo.lock'];
const before = publicFiles.map(file => fs.readFileSync(path.join(root, file)));
const cli = path.join(path.dirname(require.resolve('@napi-rs/cli/package.json')), 'dist/cli.js');
const generated = path.join(root, '.generated');
fs.mkdirSync(generated, { recursive: true });
const result = spawnSync(process.execPath, [
  cli, 'build', '--platform', ...(debug ? [] : ['--release']), '--output-dir', generated,
  '--no-js', '--dts', 'generated.d.ts', ...args, '--', '--locked',
], { cwd: root, stdio: 'inherit', timeout: 15 * 60 * 1000 });
if (result.error || result.status !== 0) { throw result.error || new Error(`Native build failed: ${result.status}`); }
for (let i = 0; i < publicFiles.length; i++) {
  assert.deepEqual(fs.readFileSync(path.join(root, publicFiles[i])), before[i], `Build overwrote ${publicFiles[i]}`);
}
const name = `sysinfo.${target.suffix}.node`;
fs.copyFileSync(path.join(generated, name), path.join(root, name));
console.log(`Built ${name}; public wrapper and declarations preserved`);
