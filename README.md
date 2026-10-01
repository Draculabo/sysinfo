# @draculabo/sysinfo-process-enhanced

Read running processes from Node.js and Electron with a native Rust binding.
Query PIDs, parent PIDs, executable paths, arguments, working directories and
start times through one asynchronous API.

Built on [Brooooooklyn/sysinfo](https://github.com/Brooooooklyn/sysinfo), this
extension adds process queries with per-call timeouts and shared scans for
concurrent requests. It is useful when a desktop app needs frequent process
checks without launching a shell for each query. The existing `SysInfo`,
`Cpu` and `cpuFeatures` exports remain available.

## Installation

Version 0.1.0 is being prepared for its first npm release. The installation
command below applies once that release is published.

```sh
npm install @draculabo/sysinfo-process-enhanced
```

Install the main package; npm selects the matching native platform dependency.
Prebuilt packages do not require Rust on the user's machine.


## Quick start

```js
import { queryProcesses } from '@draculabo/sysinfo-process-enhanced';

const processes = await queryProcesses(1000);
const current = processes.find(p => p.pid === process.pid);

if (current) {
  console.log(current.exe, current.cmd);
}
```

CommonJS is also supported:

```js
const { queryProcesses } = require('@draculabo/sysinfo-process-enhanced');
```

For Electron, call the API from the main process or another Node-enabled
process. Keep native `.node` files outside the ASAR archive when packaging.

## API

### `queryProcesses(timeoutMs)`

Returns `Promise<ProcessInfo[]>`, containing a snapshot of running processes.
`timeoutMs` must be an integer from `1` to `30000` milliseconds.

| Field | Type | Meaning |
| --- | --- | --- |
| `pid` | `number` | Process ID |
| `parentPid` | `number \| undefined` | Parent process ID |
| `name` | `string` | Process name |
| `exe` | `string \| undefined` | Executable path |
| `cmd` | `string[]` | Arguments with their boundaries preserved |
| `cwd` | `string \| undefined` | Working directory |
| `startTime` | `bigint` | Start time in Unix epoch seconds |

Permissions and platform restrictions can leave metadata unavailable. Optional
fields are `undefined`; arguments may be empty. Processes can exit while a
snapshot is being collected, so results do not guarantee that a process is
still running. PID and start time together are not a unique identity guarantee.
Convert `startTime` explicitly before serializing a record as JSON.

Overlapping calls share a native scan, while each caller keeps its own timeout.
A caller that times out stops waiting; other callers can still receive the
result. The scan may continue after callers have timed out, and a busy event
loop can delay timeout delivery.

| Error code | Meaning |
| --- | --- |
| `ERR_PROCESS_QUERY_TIMEOUT` | The caller's time budget expired |
| `ERR_PROCESS_QUERY_INVALID_TIMEOUT` | The timeout is outside the accepted range |

Native query failures also reject the promise. Handle errors at the call site.
Process selection, launching and termination are left to the application.

## Platforms

The project inherits these native build targets from upstream:

| OS | Architectures |
| --- | --- |
| Windows | x64, arm64, ia32 |
| macOS | x64, arm64 |
| Linux glibc | x64, arm64, armv7 |
| Linux musl | x64, arm64 |
| Android | arm64, armv7 |
| FreeBSD | x64 |

Process queries and Electron loading have been tested locally on Windows x64
and Ubuntu 22.04 x64 under WSL2. Runtime testing for the other targets is pending.

## Performance

Local measurements compare full process snapshots, including the cost of
starting a fresh PowerShell process for each CIM query. Thirty samples were
collected per backend. Times below are milliseconds.

| Runtime | Native P50 | Native P95 | PowerShell/CIM P50 | PowerShell/CIM P95 |
| --- | --- | --- | --- | --- |
| Windows / Node 24.15.0 | 221.1 | 270.4 | 2668.1 | 3027.3 |
| Windows / Electron 37.10.3 | 248.1 | 292.7 | 2576.7 | 2711.4 |
| WSL Ubuntu / Node 25.2.1 | 3.6 | 4.7 | — | — |

Each query checked a controlled process fixture. These are measurements from
the tested machines; latency depends on the operating system and process count.
Native and CIM results do not expose exactly the same fields.

Read the [benchmark method](benchmarks/README.md) or inspect the raw samples:
[Windows Node](benchmarks/evidence/2026-10-01-generic/report-win32.json),
[Windows Electron](benchmarks/evidence/2026-10-01-generic/report-win32-electron.json),
[WSL Node](benchmarks/evidence/2026-10-01-generic/report-linux.json).


## License

MIT. Based on [Brooooooklyn/sysinfo](https://github.com/Brooooooklyn/sysinfo).
