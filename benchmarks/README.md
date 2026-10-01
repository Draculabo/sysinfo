# Benchmark method

Build the host binding and run `yarn benchmark`. `SYSINFO_BENCHMARK_REPORT`
selects the JSON output; the default is ignored under `test-results`.
The script creates and terminates only a dedicated Node fixture. It uses no
application name, launcher flags, account data or application process selector.

## Comparable query scope

On Windows, both backends enumerate **all processes**. There is no CIM name or
executable filter. The public native API is compared with a fresh PowerShell
`Get-CimInstance Win32_Process` query, JSON transport, validation and Windows
argv parsing. Native additionally exposes cwd and startTime, which CIM does not
verify in this benchmark. This is an end-to-end API comparison, not an isolated
Rust-versus-WMI enumeration measurement.

Thirty rounds alternate backend order. Each query must locate the dedicated
fixture and match PID, executable, parent and argv. Native queries also match
cwd and bigint start time. argv includes Unicode, spaces, a quote, an empty
argument and a trailing backslash. Only fixture metadata is asserted; reports
retain timings, record counts and verification booleans, never unrelated argv.
Processes can start or exit between snapshots, so row counts need not match.
Windows exposes command-line strings rather than universal argv. Unavailable
or non-CRT command lines remain in CIM results with unavailable argv; reports
count them per sample. The fixture must still parse and match exactly.

Percentiles use nearest rank, `sorted[ceil(p * count) - 1]`, including the first
query. There is no reboot cold-start measurement or CPU/memory comparison.
Reports also verify twenty public API callers share one actual native scan,
ten additional 1s-budget calls, and independent 10ms/1s budgets on one scan.
A fast 10ms caller may complete. Event-loop delay can exceed caller budgets.

## Runtimes and evidence

For Electron, use its actual executable and `ELECTRON_RUN_AS_NODE=1`.
Set `SYSINFO_BENCHMARK_NODE` to a regular Node executable for the fixture.
WSL uses Linux Node; it does not measure Windows native performance.

Reports with protocol `all-processes-v1` under `evidence/2026-10-01-generic/`
use this method. The retained [source hashes](evidence/2026-10-01-generic/source-hashes.json)
identify the measured source snapshot; later code changes are not new measurements.
Local results do not establish full CI acceptance.
