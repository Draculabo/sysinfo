'use strict';

const { performance } = require('perf_hooks');

const NATIVE_DEADLINE_MS = 30000;

function timeoutError() {
  return Object.assign(new Error('Process query deadline exceeded'), {
    code: 'ERR_PROCESS_QUERY_TIMEOUT',
  });
}

/** One scheduler per module instance; expired callers are removed from its waiter set. */
function createProcessQuery(nativeQuery, now = () => performance.now()) {
  let scanning = false;
  const waiters = new Set();

  function finish(error, rows) {
    scanning = false;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      if (now() >= waiter.deadline) {
        waiter.reject(timeoutError());
      } else if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(rows);
      }
    }
    waiters.clear();
  }

  return function queryProcesses(timeoutMs) {
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > NATIVE_DEADLINE_MS
    ) {
      return Promise.reject(
        Object.assign(
          new RangeError('Process query timeout must be 1..30000 milliseconds'),
          { code: 'ERR_PROCESS_QUERY_INVALID_TIMEOUT' },
        ),
      );
    }
    const deadline = now() + timeoutMs;
    const result = new Promise((resolve, reject) => {
      const waiter = { deadline, resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(timeoutError());
      }, timeoutMs);
      waiters.add(waiter);
    });
    if (!scanning) {
      scanning = true;
      // Caller timeouts cannot release this slot or shorten another caller's budget.
      Promise.resolve()
        .then(() => nativeQuery(NATIVE_DEADLINE_MS))
        .then(
          (rows) => finish(undefined, rows),
          (error) => finish(error),
        );
    }
    return result;
  };
}

module.exports = { createProcessQuery };
