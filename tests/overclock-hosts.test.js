const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {fixture} = require('./private-fixture.cjs');

test('PC registration is private, retryable and does not publish rental inventory', async t => {
  const {db,as,rpc,ids} = await fixture();
  t.after(() => db.close());
  await db.exec(readFileSync('supabase/migrations/20261124_0030_lockd_overclock_hosts.sql','utf8'));
  await as('owner');
  const id = await rpc('register_lockd_overclock_pc',['Work PC','Processor and memory']);
  assert.equal(await rpc('register_lockd_overclock_pc',['Work PC','Updated report']),id);
  await assert.rejects(db.query('update lockd_overclock_hosts set owner_id=$1',[ids.customer]), /permission denied/);
  await as('customer');
  assert.deepEqual((await db.query('select * from lockd_overclock_hosts')).rows,[]);
  assert.deepEqual((await db.query('delete from lockd_overclock_hosts returning id')).rows,[]);
  await assert.rejects(rpc('register_lockd_overclock_pc',[' ','12345']),/check constraint/);
  await as('owner');
  assert.deepEqual((await db.query('select reported_specs from lockd_overclock_hosts')).rows,[{reported_specs:'Updated report'}]);
  assert.deepEqual((await db.query('delete from lockd_overclock_hosts returning id')).rows,[{id}]);
  await db.exec('reset role; set role anon');
  await assert.rejects(rpc('register_lockd_overclock_pc',['PC','12345']),/permission denied/);
});
