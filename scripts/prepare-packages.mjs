import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NapiCli } from '@napi-rs/cli';
import { targets, currentTarget } from './targets.mjs';
import { npmCommand } from './npm-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = path.join(root, 'package.json');
const original = fs.readFileSync(packageJson);
const pkg = JSON.parse(original);
const local = process.argv.includes('--local');
const selected = local ? [currentTarget()] : targets;
// Check every required binary before preparing packages; upstream prepublish
// skips missing binaries instead of failing an incomplete release.
for (const target of selected) {
  assert(fs.statSync(path.join(root, `sysinfo.${target.suffix}.node`)).size > 0, target.triple);
}
const napi = new NapiCli();
await napi.createNpmDirs({ cwd: root });
const packageDirs = selected.map(target => {
  const directory = path.join(root, 'npm', target.suffix);
  const binary = `sysinfo.${target.suffix}.node`;
  fs.copyFileSync(path.join(root, binary), path.join(directory, binary));
  return directory;
});
const release = path.join(root, 'artifacts', local ? 'local' : 'release');
fs.mkdirSync(release, { recursive: true });
const reports = [];
try {
  // Reuse the upstream manifest preparation without npm or GitHub publication.
  // Restore the source manifest even when packing fails, so source dependency
  // installation never resolves unpublished optional platform packages.
  await napi.prePublish({ cwd: root, tagStyle: 'npm', skipOptionalPublish: true, ghRelease: false });
  for (const directory of [...packageDirs, root]) {
    const packed = JSON.parse(npmCommand(['pack', '--json', '--ignore-scripts', '--pack-destination', release], directory))[0];
    const names = packed.files.map(file => file.path);
    if (directory === root) {
      for (const required of ['index.js', 'index.d.ts', 'lib/query.cjs', 'README.md']) {
        assert(names.includes(required), `Missing ${required}`);
      }
      assert(!names.some(name => /\.node$|^src\/|^target\/|^\.github\/|^\.git\/|^node_modules\/|^\.generated\//.test(name)));
    } else {
      assert.equal(names.filter(name => name.endsWith('.node')).length, 1);
      assert.equal(names.length, 3);
    }
    reports.push({ name: packed.name, version: packed.version, filename: packed.filename,
      integrity: packed.integrity, sha256: createHash('sha256').update(fs.readFileSync(path.join(release, packed.filename))).digest('hex'), files: names });
  }
} finally {
  fs.writeFileSync(packageJson, original);
}
fs.writeFileSync(path.join(release, 'manifest.json'), JSON.stringify({ version: pkg.version, local, sourceCommit: process.env.GITHUB_SHA || null, packages: reports }, null, 2) + '\n');
console.log(JSON.stringify({ version: pkg.version, scope: local ? 'host-only verification' : 'all 13 targets', tarballs: reports.length, manifest: path.join(release, 'manifest.json') }));
