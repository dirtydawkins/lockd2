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
 assert.ok(fs.readdirSync('api').filter(name=>name.endsWith('.js')).length<=12,'stay within the existing Vercel Hobby function limit');
});
test('workspace messaging capabilities start hidden and rental contact needs a real listing',()=>{
 for(const file of ['owners.html','trust.html'])assert.match(fs.readFileSync(file,'utf8'),/data-lockd-messaging-entry[^>]*hidden/);
 assert.match(fs.readFileSync('messaging-onboarding.mjs','utf8'),/capabilities\.enabled===true/);
 assert.match(fs.readFileSync('account.html','utf8'),/href="messages\.html\?inbox=renting" data-account-messages/);
 assert.match(fs.readFileSync('rental.html','utf8'),/id="rental-messages"[^>]*hidden/);
 const rental=fs.readFileSync('rental.js','utf8');
 assert.match(rental,/messages\.html\?listing=\$\{encodeURIComponent\(data\.item\.id\)\}/);
 assert.match(rental,/messagesLink\.hidden = !data\.item\.id/);
});
