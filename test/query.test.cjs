const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createProcessQuery } = require('../lib/query.cjs');

const rows = [{ pid: 42, name: 'fixture', cmd: ['', 'a b'], startTime: 100n }];
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a short caller does not poison a longer caller sharing the scan', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const scan = deferred();
  const calls = [];
  const query = createProcessQuery(budget => { calls.push(budget); return scan.promise; }, Date.now);
  const expired = assert.rejects(query(10), { code: 'ERR_PROCESS_QUERY_TIMEOUT' });
  const longer = query(1000);
  await Promise.resolve();
  t.mock.timers.tick(10);
  await expired;
  scan.resolve(rows);
  assert.deepEqual(await longer, rows);
  assert.deepEqual(calls, [30000]);
});

test('all expired callers retain one native task; completion allows a fresh scan', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const query = createProcessQuery(() => ++calls === 1 ? first.promise : second.promise, Date.now);
  const expired = assert.rejects(query(10), { code: 'ERR_PROCESS_QUERY_TIMEOUT' });
  await Promise.resolve();
  t.mock.timers.tick(10);
  await expired;
  const burst = Array.from({ length: 20 }, () => query(1000));
  await Promise.resolve();
  assert.equal(calls, 1);
  first.resolve(rows);
  assert.deepEqual(await Promise.all(burst), Array.from({ length: 20 }, () => rows));
  const fresh = query(1000);
  await Promise.resolve();
  assert.equal(calls, 2);
  second.resolve([]);
  assert.deepEqual(await fresh, []);
});

test('sync and async native failures reject every caller and release the slot', async () => {
  const nativeError = new Error('native unavailable');
  for (const failure of [() => { throw nativeError; }, () => Promise.reject(nativeError)]) {
    let calls = 0;
    const query = createProcessQuery(() => ++calls === 1 ? failure() : Promise.resolve(rows));
    const results = await Promise.allSettled([query(1000), query(1000)]);
    assert.deepEqual(results, [
      { status: 'rejected', reason: nativeError },
      { status: 'rejected', reason: nativeError },
    ]);
    assert.deepEqual(await query(1000), rows);
    assert.equal(calls, 2);
  }
});

test('invalid public timeout values never reach native enumeration', async () => {
  let calls = 0;
  const query = createProcessQuery(() => { calls++; return Promise.resolve(rows); });
  for (const value of [undefined, null, '1000', 0, -1, 1.5, NaN, Infinity, 30001]) {
    await assert.rejects(query(value), { code: 'ERR_PROCESS_QUERY_INVALID_TIMEOUT' });
  }
  assert.equal(calls, 0);
});

test('late native completion cannot win over an expired caller when timers are delayed', async () => {
  let now = 0;
  const query = createProcessQuery(() => { now = 20; return rows; }, () => now);
  await assert.rejects(query(10), { code: 'ERR_PROCESS_QUERY_TIMEOUT' });
});
