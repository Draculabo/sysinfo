use std::io::{Error, ErrorKind, Result};

#[cfg(target_os = "macos")]
pub(crate) fn read(pid: u32) -> Result<Vec<String>> {
  let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
  let mut length = 0;
  // SAFETY: the MIB and size pointers are valid; a null output queries the required size.
  if unsafe {
    libc::sysctl(
      mib.as_mut_ptr(),
      mib.len() as _,
      std::ptr::null_mut(),
      &mut length,
      std::ptr::null_mut(),
      0,
    )
  } == -1
  {
    return Err(Error::last_os_error());
  }
  let mut bytes = vec![0u8; length];
  // SAFETY: bytes owns length writable bytes; sysctl receives that capacity via length.
  if unsafe {
    libc::sysctl(
      mib.as_mut_ptr(),
      mib.len() as _,
      bytes.as_mut_ptr().cast(),
      &mut length,
      std::ptr::null_mut(),
      0,
    )
  } == -1
  {
    return Err(Error::last_os_error());
  }
  if length > bytes.len() {
    return Err(invalid_data());
  }
  bytes.truncate(length);
  parse(&bytes)
}

fn invalid_data() -> Error {
  Error::new(
    ErrorKind::InvalidData,
    "Invalid macOS process argument data",
  )
}

fn parse(bytes: &[u8]) -> Result<Vec<String>> {
  let header = bytes.get(..4).ok_or_else(invalid_data)?;
  let argc = i32::from_ne_bytes(header.try_into().map_err(|_| invalid_data())?);
  let argc = usize::try_from(argc).map_err(|_| invalid_data())?;
  if argc == 0 {
    return Ok(Vec::new());
  }
  let mut data = &bytes[4..];
  let path_end = data
    .iter()
    .position(|byte| *byte == 0)
    .ok_or_else(invalid_data)?;
  data = &data[path_end + 1..];
  // KERN_PROCARGS2 contains argc, the executable path, padding, argv, then environment.
  // Only skip padding before argv[0]; every subsequent NUL terminates one argument.
  while data.first() == Some(&0) {
    data = &data[1..];
  }
  if argc > data.len() {
    return Err(invalid_data());
  }
  let mut arguments = Vec::with_capacity(argc);
  for _ in 0..argc {
    let end = data
      .iter()
      .position(|byte| *byte == 0)
      .ok_or_else(invalid_data)?;
    let argument = std::str::from_utf8(&data[..end]).map_err(|_| invalid_data())?;
    arguments.push(argument.to_owned());
    data = &data[end + 1..];
  }
  Ok(arguments)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn fixture(arguments: &[&str], environment: &[&str]) -> Vec<u8> {
    let mut bytes = (arguments.len() as i32).to_ne_bytes().to_vec();
    bytes.extend_from_slice(b"/usr/local/bin/node\0\0\0");
    for value in arguments.iter().chain(environment) {
      bytes.extend_from_slice(value.as_bytes());
      bytes.push(0);
    }
    bytes
  }

  #[test]
  fn preserves_empty_arguments_without_consuming_environment() {
    let arguments = [
      "node",
      "query fixture 中文.cjs",
      "argument with spaces 中文",
      "quote=a\"b",
      "",
      "trailing\\",
    ];
    let bytes = fixture(&arguments, &["GITHUB_JOB=test-macOS-windows-binding"]);
    assert_eq!(parse(&bytes).unwrap(), arguments);
  }

  #[test]
  fn preserves_consecutive_and_trailing_empty_arguments() {
    let arguments = ["node", "", "", "actual=argument", "", ""];
    assert_eq!(
      parse(&fixture(&arguments, &["ENV=value"])).unwrap(),
      arguments
    );
    assert_eq!(parse(&fixture(&arguments, &[])).unwrap(), arguments);
  }

  #[test]
  fn zero_arguments_never_expose_environment() {
    assert_eq!(
      parse(&fixture(&[], &["ENV=value"])).unwrap(),
      Vec::<String>::new()
    );
  }

  #[test]
  fn rejects_invalid_or_truncated_argument_data() {
    let mut truncated = fixture(&["node", "value"], &[]);
    truncated.pop();
    let mut invalid_unicode = fixture(&["node", "value"], &[]);
    *invalid_unicode
      .iter_mut()
      .find(|byte| **byte == b'v')
      .unwrap() = 0xff;
    for bytes in [
      Vec::new(),
      vec![0, 0, 0],
      (-1i32).to_ne_bytes().to_vec(),
      1i32.to_ne_bytes().to_vec(),
      truncated,
      invalid_unicode,
    ] {
      assert_eq!(parse(&bytes).unwrap_err().kind(), ErrorKind::InvalidData);
    }
  }
}
