const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('vendored cryptography matches the exact integrity-locked package',()=>{
 assert.equal(require('../node_modules/openpgp/package.json').version,'6.3.2');
 assert.deepEqual(fs.readFileSync('vendor/openpgp-6.3.2.min.mjs'),fs.readFileSync('node_modules/openpgp/dist/openpgp.min.mjs'));
 assert.ok(fs.existsSync('vendor/OPENPGP-LICENSE.txt'));assert.ok(fs.existsSync('vendor/REALTIME-LICENSE.txt'));
});
