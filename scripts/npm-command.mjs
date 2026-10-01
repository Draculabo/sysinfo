import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Yarn manages source dependencies. npm is used only for consumer/install and
// release operations; npm_execpath can point to Yarn inside a Yarn script.
export function npmCommand(args, cwd, extraEnv = {}) {
  const nodeDirectory = path.dirname(fs.realpathSync(process.execPath));
  const candidates = [
    process.env.npm_execpath,
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(process.env.PATH || '').split(path.delimiter).flatMap(directory => [
      path.join(directory, 'npm'),
      path.join(directory, 'node_modules/npm/bin/npm-cli.js'),
      path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ]),
  ].filter(file => file && fs.existsSync(file)).map(file => fs.realpathSync(file));
  const cli = candidates.find(file => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
  assert(cli, 'npm CLI is required for package validation and publication');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, env: { ...process.env, ...extraEnv }, encoding: 'utf8',
    timeout: 5 * 60 * 1000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`npm ${args[0]} failed: ${(result.stderr || result.stdout).slice(0,4000)}`);
  }
  return result.stdout;
}
