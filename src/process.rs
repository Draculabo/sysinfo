use std::time::{Duration, Instant};

#[cfg(any(target_os = "macos", test))]
mod macos_args;

use napi::{
  bindgen_prelude::{AsyncTask, BigInt},
  Env, Error, Result, Status, Task,
};
use napi_derive::napi;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[napi(object)]
pub struct ProcessInfo {
  pub pid: u32,
  pub parent_pid: Option<u32>,
  pub name: String,
  pub exe: Option<String>,
  pub cmd: Vec<String>,
  pub cwd: Option<String>,
  /// Epoch seconds for diagnostics, not a unique process identity.
  pub start_time: BigInt,
}

pub struct ProcessQuery {
  deadline: Instant,
}

#[napi]
impl Task for ProcessQuery {
  type Output = Vec<ProcessInfo>;
  type JsValue = Vec<ProcessInfo>;

  fn compute(&mut self) -> Result<Self::Output> {
    self.check_deadline()?;
    let mut system = System::new();
    let refresh_kind = ProcessRefreshKind::nothing()
      .with_exe(UpdateKind::Always)
      .with_cwd(UpdateKind::Always)
      .without_tasks();
    #[cfg(not(target_os = "macos"))]
    let refresh_kind = refresh_kind.with_cmd(UpdateKind::Always);
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh_kind);
    self.check_deadline()?;
    let mut result = Vec::with_capacity(system.processes().len());
    for process in system.processes().values() {
      self.check_deadline()?;
      let Some(cmd) = process_arguments(process)? else {
        continue;
      };
      result.push(ProcessInfo {
        pid: process.pid().as_u32(),
        parent_pid: process.parent().map(|pid| pid.as_u32()),
        name: process.name().to_string_lossy().into_owned(),
        exe: process
          .exe()
          .and_then(|path| path.to_str())
          .map(str::to_owned),
        cmd,
        cwd: process
          .cwd()
          .and_then(|path| path.to_str())
          .map(str::to_owned),
        start_time: process.start_time().into(),
      });
    }
    result.sort_unstable_by_key(|process| process.pid);
    Ok(result)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    self.check_deadline()?;
    Ok(output)
  }
}

#[cfg(target_os = "macos")]
fn process_arguments(process: &sysinfo::Process) -> Result<Option<Vec<String>>> {
  match macos_args::read(process.pid().as_u32()) {
    Ok(arguments) => Ok(Some(arguments)),
    // Processes can exit between enumeration and sysctl; protected processes expose no argv.
    Err(error) if matches!(error.raw_os_error(), Some(libc::ESRCH | libc::EINVAL)) => Ok(None),
    Err(error) if matches!(error.raw_os_error(), Some(libc::EPERM | libc::EACCES)) => {
      Ok(Some(Vec::new()))
    }
    Err(_) => Err(Error::new(
      Status::GenericFailure,
      "Process arguments could not be read",
    )),
  }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn process_arguments(process: &sysinfo::Process) -> Result<Option<Vec<String>>> {
  // sysinfo removes empty /proc fields. Preserve empty argv without altering upstream code.
  let bytes = match std::fs::read(format!("/proc/{}/cmdline", process.pid())) {
    Ok(bytes) => bytes,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
      return Ok(Some(Vec::new()))
    }
    Err(_) => {
      return Err(Error::new(
        Status::GenericFailure,
        "Process arguments could not be read",
      ))
    }
  };
  if bytes.is_empty() {
    return Ok(Some(Vec::new()));
  }
  let argv = bytes.strip_suffix(&[0]).unwrap_or(&bytes);
  argv
    .split(|byte| *byte == 0)
    .map(|arg| {
      std::str::from_utf8(arg).map(str::to_owned).map_err(|_| {
        Error::new(
          Status::GenericFailure,
          "Process arguments are not valid Unicode",
        )
      })
    })
    .collect::<Result<Vec<_>>>()
    .map(Some)
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
fn process_arguments(process: &sysinfo::Process) -> Result<Option<Vec<String>>> {
  process
    .cmd()
    .iter()
    .map(|arg| {
      arg.to_str().map(str::to_owned).ok_or_else(|| {
        Error::new(
          Status::GenericFailure,
          "Process arguments are not valid Unicode",
        )
      })
    })
    .collect::<Result<Vec<_>>>()
    .map(Some)
}

impl ProcessQuery {
  fn check_deadline(&self) -> Result<()> {
    if Instant::now() >= self.deadline {
      return Err(Error::new(
        Status::GenericFailure,
        "Process query deadline exceeded",
      ));
    }
    Ok(())
  }
}

/// A fresh, read-only snapshot on libuv's worker pool. No System state is shared.
#[napi]
pub fn query_processes(timeout_ms: u32) -> Result<AsyncTask<ProcessQuery>> {
  if timeout_ms == 0 || timeout_ms > 30_000 {
    return Err(Error::new(
      Status::InvalidArg,
      "Process query timeout must be 1..30000 milliseconds",
    ));
  }
  Ok(AsyncTask::new(ProcessQuery {
    deadline: Instant::now() + Duration::from_millis(timeout_ms.into()),
  }))
}
