import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import parser from './windows-argv.cjs';

const execute = promisify(execFile);
function validRecord(row) {
  return row !== null && typeof row === 'object'
    && Number.isSafeInteger(row.ProcessId) && row.ProcessId >= 0
    && Number.isSafeInteger(row.ParentProcessId) && row.ParentProcessId >= 0
    && typeof row.Name === 'string'
    && (row.ExecutablePath === null || typeof row.ExecutablePath === 'string')
    && (row.CommandLine === null || typeof row.CommandLine === 'string');
}

// Query all processes. Each sample includes fresh PowerShell startup, CIM,
// JSON transport and argv parsing, matching the public native snapshot boundary.
export async function queryCimProcesses(timeoutMs) {
  const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
  const { stdout } = await execute(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
  });
  let parsed;
  try { parsed = JSON.parse(stdout.trim()); }
  catch { throw new Error('CIM returned invalid process metadata'); }
  const rows = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.every(validRecord)) { throw new Error('CIM returned invalid process metadata'); }
  return rows.map(row => {
    let cmd;
    if (row.CommandLine) {
      try { cmd = parser.parseWindowsCommandLine(row.CommandLine); }
      catch (error) {
        // Windows exposes a command-line string, not universal argv. Some
        // applications use different quoting rules; keep the process observable.
        if (!(error instanceof SyntaxError)) { throw error; }
      }
    }
    return {
    pid: row.ProcessId, parentPid: row.ParentProcessId, name: row.Name,
    exe: row.ExecutablePath || undefined,
    cmd,
  };
  });
}
