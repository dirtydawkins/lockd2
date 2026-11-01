const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
esbuild.buildSync({entryPoints:[path.join(__dirname,'realtime-entry.mjs')],bundle:true,minify:true,platform:'browser',format:'esm',target:['es2022'],outfile:path.join(root,'vendor/realtime-2.118.0.min.mjs'),legalComments:'eof'});
fs.copyFileSync(path.join(root,'node_modules/@supabase/realtime-js/LICENSE'),path.join(root,'vendor/REALTIME-LICENSE.txt'));
