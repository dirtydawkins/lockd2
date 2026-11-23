const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { fixture } = require('./private-fixture.cjs');

test('pilot interest is editable, private, and withdrawable by its owner', async t => {
  const { db, as, rpc, ids } = await fixture();
  t.after(() => db.close());
  await db.exec(readFileSync('supabase/migrations/20261123_0029_lockd_overclock_pilot.sql', 'utf8'));
  await as('customer');
  assert.equal(await rpc('set_lockd_overclock_interest', ['studio']), 'studio');
  assert.equal(await rpc('set_lockd_overclock_interest', ['ai']), 'ai');
  await assert.rejects(rpc('set_lockd_overclock_interest', ['other']), /check constraint/);
  await assert.rejects(db.query('insert into lockd_overclock_pilot(user_id, track) values ($1, $2)', [ids.owner, 'play']), /permission denied/);

  await as('owner');
  assert.deepEqual((await db.query('select track from lockd_overclock_pilot')).rows, []);
  assert.deepEqual((await db.query('delete from lockd_overclock_pilot returning track')).rows, []);
  await as('customer');
  assert.deepEqual((await db.query('delete from lockd_overclock_pilot returning track')).rows, [{ track: 'ai' }]);

  await db.exec('reset role; set role anon');
  await assert.rejects(rpc('set_lockd_overclock_interest', ['studio']), /permission denied/);
});
