import fs from 'node:fs';
import { parseTriple } from '@napi-rs/cli';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const targets = pkg.napi.targets.map(triple => {
  const target = parseTriple(triple);
  const libc = target.abi?.startsWith('gnu') ? 'glibc'
    : target.abi?.startsWith('musl') ? 'musl' : undefined;
  return { triple, suffix: target.platformArchABI, os: target.platform, cpu: target.arch, libc };
});

export function currentTarget() {
  const libc = process.platform === 'linux'
    ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl')
    : undefined;
  const target = targets.find(t => t.os === process.platform && t.cpu === process.arch && t.libc === libc);
  if (!target) { throw new Error(`Unsupported build host: ${process.platform}/${process.arch}`); }
  return target;
}
