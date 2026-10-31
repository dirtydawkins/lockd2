// Generate explicitly isolated native-PostgreSQL QA scripts, never production fixtures.
const fs=require('node:fs'),path=require('node:path');
const schema='lockd_qa_20261101_ab3f';const out=path.join(__dirname,'native-qa');fs.mkdirSync(out,{recursive:true});
const transform=s=>s.replaceAll('public.',schema+'.').replaceAll('auth.users',schema+'.auth_users').replaceAll('auth.uid()',schema+'.uid()').replaceAll('auth.jwt()',schema+'.jwt()').replace(/search_path\s*=\s*public/g,'search_path='+schema).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
let setup=`begin;
create schema ${schema};
grant usage on schema ${schema} to authenticated;
create table ${schema}.auth_users(id uuid primary key,email_confirmed_at timestamptz);
alter table ${schema}.auth_users enable row level security;
create function ${schema}.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function ${schema}.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
insert into ${schema}.auth_users values('11111111-1111-4111-8111-111111111111',now()),('22222222-2222-4222-8222-222222222222',now()),('33333333-3333-4333-8333-333333333333',now());
`;
setup+=transform(fs.readFileSync('supabase/migrations/20261028_0001_lockd_catalogue.sql','utf8'));
setup+=`\nalter table ${schema}.lockd_listings add column deposit_amount numeric(12,2),add column deposit_currency text;\n`;
for(const file of ['20261031_0008_lockd_reservations.sql','20261101_0009_lockd_trust.sql','20261101_0010_lockd_operations.sql','20261101_0011_lockd_identity_jobs.sql'])setup+=transform(fs.readFileSync('supabase/migrations/'+file,'utf8'))+'\n';
setup+=`update ${schema}.lockd_booking_settings set requests_enabled=true where singleton;
insert into ${schema}.lockd_listings(id,owner_id,slug,title,category,price_amount,currency,price_unit,listing_status,approval_status,deposit_amount,deposit_currency)
values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','isolated-qa','SYNTHETIC PRIVATE QA','drive',10.25,'KES','day','published','approved',5,'KES');
insert into ${schema}.lockd_listing_availability select '44444444-4444-4444-8444-444444444444',current_date+i,1,now() from generate_series(0,30)i;
commit;
select '${schema}' as isolated_schema,'SYNTHETIC TEST DATA ONLY' as scope;
`;
fs.writeFileSync(path.join(out,'setup.sql'),setup);
fs.writeFileSync(path.join(out,'connection-a.sql'),`-- LOCKD_QA_CONCURRENT_A
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select ${schema}.request_lockd_booking('44444444-4444-4444-8444-444444444444',current_date+1,current_date+3,1,'55555555-5555-4555-8555-555555555555',25.50,'KES')->>'status' as first_request;
select pg_sleep(35);
commit;
select 'first reservation committed' as result;
`);
fs.writeFileSync(path.join(out,'connection-b.sql'),`-- LOCKD_QA_CONCURRENT_B
select count(*)::int as concurrent_a_running from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query like '%LOCKD_QA_CONCURRENT_A%';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$begin
 begin
  perform ${schema}.request_lockd_booking('44444444-4444-4444-8444-444444444444',current_date+1,current_date+3,1,'66666666-6666-4666-8666-666666666666',25.50,'KES');
  raise exception 'TEST FAILED: overlapping request was accepted';
 exception when others then
  if sqlerrm<>'These dates are unavailable.' then raise; end if;
 end;
end $$;
commit;
select 'competing reservation rejected' as result,(select count(*) from ${schema}.lockd_bookings) as booking_count;
`);
fs.writeFileSync(path.join(out,'cleanup.sql'),`-- Only the schema created by setup.sql; no live data.
drop schema ${schema} cascade;
select to_regnamespace('${schema}') is null as qa_removed;
`);
console.log('Generated isolated QA scripts under tests/native-qa/');
