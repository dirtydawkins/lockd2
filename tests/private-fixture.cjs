const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const ids={owner:'11111111-1111-4111-8111-111111111111',customer:'22222222-2222-4222-8222-222222222222',admin:'33333333-3333-4333-8333-333333333333',stranger:'55555555-5555-4555-8555-555555555555',listing:'44444444-4444-4444-8444-444444444444'};
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth,storage to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant insert on storage.objects to authenticated;
 insert into auth.users values('${ids.owner}',now()),('${ids.customer}',now()),('${ids.admin}',now()),('${ids.stranger}',now());`);
 await db.exec(fs.readFileSync('supabase/migrations/20261028_0001_lockd_catalogue.sql','utf8'));
 await db.exec('alter table lockd_listings add column deposit_amount numeric(12,2),add column deposit_currency text;');
 for(const file of ['20261031_0008_lockd_reservations.sql','20261101_0009_lockd_trust.sql','20261101_0010_lockd_operations.sql','20261101_0011_lockd_identity_jobs.sql','20261101_0012_lockd_documents.sql','20261101_0013_lockd_messaging.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(`insert into lockd_listings(id,owner_id,slug,title,category,price_amount,currency,price_unit,listing_status,approval_status) values('${ids.listing}','${ids.owner}','private-fixture','Synthetic test rental','drive',100,'KES','day','published','approved');`);
 const as=async (who,role='customer')=>{
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[ids[who]||who,JSON.stringify({app_metadata:{role}})]);
  await db.exec('set role authenticated');
 };
 const rpc=async(name,args=[])=> (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) item`,args)).rows[0].item;
 return {db,as,rpc,ids};
}
module.exports={fixture,ids};
