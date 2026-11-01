// Copies an exact, integrity-locked registry dependency. Do not load crypto from a CDN.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const pkg=require('../node_modules/openpgp/package.json');
if(pkg.version!=='6.3.2') throw Error('Review a dependency upgrade before vendoring.');
fs.mkdirSync(path.join(root,'vendor'),{recursive:true});
for(const [source,target] of [['dist/openpgp.min.mjs','openpgp-6.3.2.min.mjs'],['LICENSE','OPENPGP-LICENSE.txt']])
  fs.copyFileSync(path.join(root,'node_modules/openpgp',source),path.join(root,'vendor',target));
