const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('customer pages contain no fixture copy or separate messaging credentials',()=>{
 const pages=fs.readdirSync('.').filter(name=>name.endsWith('.html'));
 for(const page of pages)assert.doesNotMatch(fs.readFileSync(page,'utf8'),/\bsynthetic\b|\bfixture\b|local image qa|image layout test|message password|messaging passphrase|unlock-form/i,page);
 const chat=fs.readFileSync('messages.html','utf8');assert.doesNotMatch(chat,/<input[^>]+type="password"/i);
 assert.match(fs.readFileSync('messages.mjs','utf8'),/ensureMessageDevice/);
});
test('production packaging excludes fixtures and legacy duplicates but retains function dependencies',()=>{
 const ignore=fs.readFileSync('.vercelignore','utf8').split(/\r?\n/);
 assert.ok(ignore.includes('tests/'));assert.ok(ignore.includes('lockd2/'));assert.ok(ignore.includes('services/'));
 assert.equal(ignore.includes('lib/'),false,'server RPC helpers must be uploaded for Vercel function tracing');
});
test('unfinished capabilities are hidden until the backend enables them',()=>{
 for(const file of ['account.html','owners.html','trust.html','rental.html'])assert.match(fs.readFileSync(file,'utf8'),/data-lockd-messaging-entry[^>]*hidden/);
 assert.match(fs.readFileSync('messaging-onboarding.mjs','utf8'),/capabilities\.enabled===true/);
});
