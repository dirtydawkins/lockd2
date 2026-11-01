-- One sandbox orchestrator over existing Auth, bookings, document storage, queue and audit.
-- No provider success, evidence, accounts, policies or marketplace inventory is seeded.
begin;
create table public.lockd_verification_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 uploads_enabled boolean not null default false, policy_approved_at timestamptz,
 consent_version text not null default 'verification-sandbox-1',
 retention_days integer not null default 30 check(retention_days between 1 and 90)
);
insert into public.lockd_verification_settings(singleton) values(true);
create table public.lockd_verification_sandbox_members (
 user_id uuid primary key references auth.users(id) on delete restrict,
 expires_at timestamptz not null, can_review boolean not null default false
);
create table public.lockd_sandbox_rental_requirements (
 policy_id bigint primary key references public.lockd_verification_policies(id),
 required_checks text[] not null check(required_checks<@array['identity','address','financial','credit','fraud','student']::text[]),
 purpose text not null check(length(trim(purpose)) between 10 and 1000),
 credit_purpose_approved boolean not null default false
);
create table public.lockd_verification_cases (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 booking_id uuid references public.lockd_bookings(id) on delete restrict,
 listing_id uuid references public.lockd_listings(id) on delete restrict,
 environment text not null default 'sandbox' check(environment='sandbox'),
 request_key uuid not null, required_checks text[] not null,
 financial_method text check(financial_method in ('mpesa','bank')),
 declared_address text check(length(declared_address)<=1000),
 policy_id bigint references public.lockd_verification_policies(id),
 booking_snapshot jsonb, purpose text not null,
 state text not null default 'awaiting_upload' check(state in ('awaiting_upload','processing','needs_confirmation','under_review','additional_information','verified','unable_to_verify','rejected','expired','revoked','withdrawn')),
 version integer not null default 1, reviewer_id uuid references auth.users(id), review_reason text,
 appeal_used boolean not null default false, withdrawn_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null,
 unique(user_id,request_key),check(booking_id is not null or required_checks=array['address']::text[])
);
create index lockd_verification_case_user on public.lockd_verification_cases(user_id,created_at desc);
create index lockd_verification_case_booking on public.lockd_verification_cases(booking_id) where booking_id is not null;
create table public.lockd_verification_consents (
 case_id uuid not null references public.lockd_verification_cases(id),
 purpose text not null check(purpose in ('processing','credit')), version text not null,
 user_id uuid not null references auth.users(id), granted_at timestamptz not null default now(),
 primary key(case_id,purpose)
);
create trigger lockd_verification_consent_immutable before update or delete on public.lockd_verification_consents for each row execute function public.lockd_immutable_trust_record();
create table public.lockd_credit_requests (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.lockd_verification_cases(id),
 provider text not null check(provider in ('creditinfo','metropol')),
 environment text not null default 'sandbox' check(environment='sandbox'),
 state text not null default 'blocked' check(state in ('blocked','processing','received','unavailable','unknown')),
 provider_reference text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(case_id,provider)
);
-- Reuse the existing evidence store and leased queue; a document belongs to one workflow.
alter table public.lockd_verification_documents alter column case_id drop not null;
alter table public.lockd_verification_documents add column verification_case_id uuid references public.lockd_verification_cases(id),
 add column evidence_kind text check(evidence_kind in ('utility','tenancy','student','family','landlord','other','mpesa','bank')),
 add constraint lockd_document_one_case check(num_nonnulls(case_id,verification_case_id)=1),
 add constraint lockd_document_kind_required check(verification_case_id is null or evidence_kind is not null);
alter table public.lockd_document_analyses alter column case_id drop not null;
alter table public.lockd_document_analyses add column verification_case_id uuid references public.lockd_verification_cases(id),
 add constraint lockd_analysis_one_case check(num_nonnulls(case_id,verification_case_id)=1);
alter table public.lockd_document_corrections alter column case_id drop not null;
alter table public.lockd_document_corrections add column verification_case_id uuid references public.lockd_verification_cases(id),
 add constraint lockd_correction_one_case check(num_nonnulls(case_id,verification_case_id)=1),
 add unique(verification_case_id,version);
create index lockd_verification_evidence_case on public.lockd_verification_documents(verification_case_id);

create function public.lockd_require_verification_sandbox(p_review boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 if not exists(select 1 from public.lockd_verification_settings where singleton and enabled and policy_approved_at is not null)
 or not exists(select 1 from public.lockd_verification_sandbox_members where user_id=auth.uid() and expires_at>now() and (not p_review or can_review)) then raise exception 'Verification is not available for this account.'; end if;
 if p_review then perform public.lockd_require_trust_admin(); end if;
end $$;
create function public.lockd_verification_capabilities() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('enabled',s.enabled and s.policy_approved_at is not null and exists(select 1 from public.lockd_verification_sandbox_members where user_id=auth.uid() and expires_at>now()),
 'uploadsEnabled',s.uploads_enabled,'environment','sandbox','consentVersion',s.consent_version,'retentionDays',s.retention_days,
 'reviewer',exists(select 1 from public.lockd_verification_sandbox_members where user_id=auth.uid() and can_review and expires_at>now()) and coalesce(auth.jwt()->'app_metadata'->>'role','')='admin')
 from public.lockd_verification_settings s where singleton
$$;
create function public.lockd_verification_requirements(p_booking_id uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype;r public.lockd_sandbox_rental_requirements%rowtype;
begin
 perform public.lockd_require_verification_sandbox();
 if p_booking_id is null then return jsonb_build_object('checks',array['address'],'purpose','Review your chosen address evidence.','creditAllowed',false);end if;
 select * into b from public.lockd_bookings where id=p_booking_id and customer_id=auth.uid();
 if not found or b.status not in ('pending_owner','awaiting_payment','confirmed') or (b.status in ('pending_owner','awaiting_payment') and b.expires_at<=now()) then raise exception 'Reservation is unavailable for verification.';end if;
 select * into r from public.lockd_sandbox_rental_requirements where policy_id=b.trust_policy_id;
 return jsonb_build_object('checks',coalesce(r.required_checks,'{}'::text[]),'purpose',r.purpose,'creditAllowed',coalesce(r.credit_purpose_approved,false));
end $$;
create function public.create_lockd_verification_case(p_booking_id uuid,p_method text,p_address text,p_consent text,p_credit_consent boolean,p_request_key uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_verification_cases%rowtype; b public.lockd_bookings%rowtype; s public.lockd_verification_settings%rowtype;
 r public.lockd_sandbox_rental_requirements%rowtype; checks text[]:=array['address']::text[]; why text:='Review the address evidence you choose to provide.';
begin
 perform public.lockd_require_verification_sandbox();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,23));
 select * into s from public.lockd_verification_settings where singleton;
 if p_request_key is null or p_consent is distinct from s.consent_version or (p_method is not null and p_method not in ('mpesa','bank')) then raise exception 'Review the verification details and consent.'; end if;
 if p_booking_id is not null then
  select * into b from public.lockd_bookings where id=p_booking_id and customer_id=auth.uid() for share;
  if not found or b.status not in ('pending_owner','awaiting_payment','confirmed') or (b.status in ('pending_owner','awaiting_payment') and b.expires_at<=now()) then raise exception 'Reservation is unavailable for verification.'; end if;
  if not exists(select 1 from public.lockd_listings where id=b.listing_id) then raise exception 'Reservation is unavailable for verification.'; end if;
  select * into r from public.lockd_sandbox_rental_requirements where policy_id=b.trust_policy_id;
  if not found or cardinality(r.required_checks)=0 then raise exception 'No additional verification is required.'; end if;
  checks:=r.required_checks;why:=r.purpose;
 end if;
 if 'financial'=any(checks) and p_method is null then raise exception 'Choose M-Pesa or bank statement.'; end if;
 if not ('financial'=any(checks)) and p_method is not null then raise exception 'Financial evidence is not required.'; end if;
 if 'address'=any(checks) and length(trim(coalesce(p_address,''))) not between 5 and 1000 then raise exception 'Add the address you want reviewed.'; end if;
 if p_credit_consent and (not ('credit'=any(checks)) or not coalesce(r.credit_purpose_approved,false)) then raise exception 'Credit checks are not available for this reservation.'; end if;
 select * into c from public.lockd_verification_cases where user_id=auth.uid() and request_key=p_request_key;
 if found then
  if c.booking_id is distinct from p_booking_id or c.financial_method is distinct from p_method then raise exception 'Submission retry differs from the original.'; end if;
  return c.id;
 end if;
 if (select count(*) from public.lockd_verification_cases where user_id=auth.uid() and created_at>now()-interval '1 day')>=5 then raise exception 'Please try again tomorrow.'; end if;
 insert into public.lockd_verification_cases(user_id,booking_id,listing_id,request_key,required_checks,financial_method,declared_address,policy_id,booking_snapshot,purpose,expires_at)
 values(auth.uid(),b.id,b.listing_id,p_request_key,checks,p_method,case when 'address'=any(checks) then trim(p_address) end,b.trust_policy_id,
 case when b.id is not null then jsonb_build_object('currency',b.currency,'rentalAmount',b.rental_amount,'depositAmount',b.deposit_amount,'totalAmount',b.total_amount,'startDate',b.start_date,'endDate',b.end_date) end,
 why,now()+make_interval(days=>s.retention_days)) returning * into c;
 insert into public.lockd_verification_consents(case_id,purpose,version,user_id) values(c.id,'processing',s.consent_version,auth.uid());
 if p_credit_consent then insert into public.lockd_verification_consents(case_id,purpose,version,user_id) values(c.id,'credit',s.consent_version,auth.uid()); end if;
 insert into public.lockd_document_audit(actor_id,case_id,event,details) values(auth.uid(),c.id,'sandbox_consent_recorded',jsonb_build_object('credit',p_credit_consent));
 return c.id;
end $$;

create function public.my_lockd_verification_cases() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select c.id,c.booking_id,c.required_checks,c.financial_method,c.purpose,c.environment,c.version,c.review_reason,c.created_at,c.expires_at,c.appeal_used,
 case when c.expires_at<=now() and c.state not in ('withdrawn','revoked') then 'expired' else c.state end state,
 case when c.expires_at>now() then c.declared_address end declared_address,
 coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.evidence_kind,'state',d.state,'fields',a.result->'fields','summary',a.result->'financial'->'summary','findings',a.result->'findings'))
 from public.lockd_verification_documents d left join public.lockd_document_analyses a on a.document_id=d.id
 where d.verification_case_id=c.id and d.state='screened' and d.retention_expires_at>now() and c.expires_at>now() and c.withdrawn_at is null),'[]') documents
 from public.lockd_verification_cases c where c.user_id=auth.uid() order by c.created_at desc limit 30)x),'[]');
end $$;

create function public.reserve_lockd_verification_document(p_case_id uuid,p_kind text,p_mime text,p_bytes integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_verification_cases%rowtype; d public.lockd_verification_documents%rowtype; did uuid:=gen_random_uuid();
begin
 perform public.lockd_require_verification_sandbox();
 select * into c from public.lockd_verification_cases where id=p_case_id and user_id=auth.uid() for update;
 if not found or c.state not in ('awaiting_upload','additional_information','needs_confirmation') or c.withdrawn_at is not null or c.expires_at<=now() then raise exception 'Submission is unavailable.'; end if;
 if not exists(select 1 from public.lockd_verification_settings where singleton and uploads_enabled) then raise exception 'Uploads are unavailable.'; end if;
 if p_kind in ('mpesa','bank') then
  if not ('financial'=any(c.required_checks)) or p_kind is distinct from c.financial_method or p_mime<>'application/pdf' then raise exception 'Choose the selected financial statement as a PDF.'; end if;
 elsif p_kind in ('utility','tenancy','student','family','landlord','other') then
  if not ('address'=any(c.required_checks)) then raise exception 'Address evidence is not required.'; end if;
 else raise exception 'Unsupported evidence.'; end if;
 if p_kind='utility' and p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Utility bills require a photograph.'; end if;
 if (select count(*) from public.lockd_verification_documents where verification_case_id=c.id)>=6 then raise exception 'Document limit reached.'; end if;
 insert into public.lockd_verification_documents(id,verification_case_id,evidence_kind,user_id,object_path,declared_mime,byte_size,retention_expires_at)
 values(did,c.id,p_kind,auth.uid(),auth.uid()::text||'/'||c.id::text||'/'||did::text,p_mime,p_bytes,least(c.expires_at,now()+interval '1 day')) returning * into d;
 return jsonb_build_object('id',d.id,'path',d.object_path,'bucket','lockd-verification-private');
end $$;

-- Preserve legacy utility enforcement and extend it to the orchestrated workflow.
create or replace function public.lockd_require_utility_photo() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (new.evidence_kind='utility' or exists(select 1 from public.lockd_address_cases where id=new.case_id and method='utility'))
 and new.declared_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Utility bills require a JPG, PNG or WebP photograph.'; end if;
 return new;
end $$;
alter function public.lockd_document_upload_allowed(text) rename to lockd_document_upload_allowed_legacy;
revoke all on function public.lockd_document_upload_allowed_legacy(text) from public,anon,authenticated,service_role;
create function public.lockd_document_upload_allowed(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (public.lockd_document_upload_allowed_legacy(p_path) and not exists(select 1 from public.lockd_verification_documents d join public.lockd_address_cases c on c.id=d.case_id where d.object_path=p_path and c.method='kra_certificate')) or exists(
 select 1 from public.lockd_verification_documents d join public.lockd_verification_cases c on c.id=d.verification_case_id
 join public.lockd_verification_settings s on s.singleton join public.lockd_verification_sandbox_members m on m.user_id=c.user_id
 where d.object_path=p_path and c.user_id=auth.uid() and d.user_id=auth.uid() and d.state='reserved' and d.created_at>now()-interval '15 minutes'
 and c.withdrawn_at is null and c.expires_at>now() and m.expires_at>now() and s.enabled and s.uploads_enabled and s.policy_approved_at is not null)
$$;
-- Storage policies hold function OIDs; rebuild this policy so it calls the new wrapper.
drop policy lockd_document_quarantine_insert on storage.objects;
create policy lockd_document_quarantine_insert on storage.objects for insert to authenticated with check(bucket_id='lockd-verification-private' and public.lockd_document_upload_allowed(name));
create function public.queue_lockd_verification_document(p_document_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype;
begin
 perform public.lockd_require_verification_sandbox();
 select * into d from public.lockd_verification_documents where id=p_document_id and user_id=auth.uid() and verification_case_id is not null for update;
 if not found then raise exception 'Document is unavailable.'; end if;
 perform 1 from public.lockd_verification_cases where id=d.verification_case_id for update;
 if d.state<>'reserved' then return; end if;
 if not public.lockd_document_upload_allowed(d.object_path) or not exists(select 1 from storage.objects where bucket_id='lockd-verification-private' and name=d.object_path and coalesce(metadata->>'size','0')::bigint=d.byte_size) then raise exception 'Upload is incomplete.'; end if;
 update public.lockd_verification_documents set state='quarantined' where id=d.id;
 insert into public.lockd_document_jobs(document_id) values(d.id) on conflict do nothing;
 update public.lockd_verification_cases set state='processing',version=version+1,updated_at=now() where id=d.verification_case_id;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),d.verification_case_id,'sandbox_document_quarantined');
end $$;

alter function public.claim_lockd_document_job() rename to lockd_claim_address_document_job;
revoke all on function public.lockd_claim_address_document_job() from public,anon,authenticated,service_role;
create function public.claim_lockd_document_job() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare legacy jsonb; j public.lockd_document_jobs%rowtype; d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype;
begin
 update public.lockd_document_jobs set state='cancelled',lease_token=null where document_id in(select d.id from public.lockd_verification_documents d join public.lockd_address_cases c on c.id=d.case_id where c.method='kra_certificate') and state in ('pending','retry');
 legacy:=public.lockd_claim_address_document_job();if legacy is not null then return legacy;end if;
 if exists(select 1 from public.lockd_document_jobs where state='processing' and lease_until>now()) then return null; end if;
 select x.* into j from public.lockd_document_jobs x join public.lockd_verification_documents d on d.id=x.document_id
 join public.lockd_verification_cases c on c.id=d.verification_case_id join public.lockd_verification_settings s on s.singleton
 join public.lockd_verification_sandbox_members m on m.user_id=c.user_id
 where s.enabled and s.uploads_enabled and s.policy_approved_at is not null and m.expires_at>now() and c.withdrawn_at is null and c.expires_at>now()
 and d.retention_expires_at>now() and d.state not in ('blocked','deletion_pending','deleted') and x.attempts<5
 and ((x.state in ('pending','retry') and x.available_at<=now()) or (x.state='processing' and x.lease_until<=now()))
 order by x.available_at for update of x skip locked limit 1;
 if not found then return null; end if;
 update public.lockd_document_jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where document_id=j.document_id returning * into j;
 update public.lockd_verification_documents set state='processing' where id=j.document_id returning * into d;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id;
 return jsonb_build_object('document_id',d.id,'path',d.object_path,'mime',d.declared_mime,'byte_size',d.byte_size,'lease_token',j.lease_token,'method',d.evidence_kind,'declared_address',coalesce(c.declared_address,''),'environment','sandbox',
 'booking_obligation',(select total_amount::text from public.lockd_bookings where id=c.booking_id and customer_id=c.user_id),
 'booking_currency',(select currency from public.lockd_bookings where id=c.booking_id and customer_id=c.user_id));
end $$;

alter function public.finish_lockd_document_job(uuid,uuid,jsonb,text) rename to lockd_finish_address_document_job;
revoke all on function public.lockd_finish_address_document_job(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
create function public.finish_lockd_document_job(p_document_id uuid,p_lease_token uuid,p_result jsonb,p_error text default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype; j public.lockd_document_jobs%rowtype;
begin
 select * into d from public.lockd_verification_documents where id=p_document_id;
 if d.verification_case_id is null then return public.lockd_finish_address_document_job(p_document_id,p_lease_token,p_result,p_error); end if;
 select * into j from public.lockd_document_jobs where document_id=p_document_id and state='processing' and lease_token=p_lease_token and lease_until>now() for update;
 if not found then return false;end if;
 select * into d from public.lockd_verification_documents where id=p_document_id for update;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id for update;
 if c.withdrawn_at is not null or c.expires_at<=now() or d.retention_expires_at<=now() or d.state in ('deleted','deletion_pending') then
  update public.lockd_document_jobs set state='cancelled',lease_token=null where document_id=d.id;return false;
 end if;
 if p_error is not null then
  if p_error not in ('scanner_unavailable','unsafe_file','analysis_unavailable','storage_unavailable') then raise exception 'Invalid processing result.';end if;
  update public.lockd_document_jobs set state=case when attempts>=5 or p_error='unsafe_file' then 'dead_letter' else 'retry' end,error_code=p_error,available_at=now()+make_interval(secs=>least(1800,30*(2^attempts)::integer)),lease_until=null where document_id=d.id;
  update public.lockd_verification_documents set state=case when p_error='unsafe_file' then 'blocked' else 'unavailable' end,scanner_status=case when p_error='unsafe_file' then 'blocked' when p_error='scanner_unavailable' then 'unavailable' else scanner_status end where id=d.id;
  update public.lockd_verification_cases set state='additional_information',version=version+1,updated_at=now() where id=c.id;
 else
  if p_result is null or octet_length(p_result::text)>262144 or p_result->>'issuer_status' is distinct from 'not_independently_verified' or p_result->>'trained_model' is distinct from 'false' or coalesce(p_result->>'sha256','') !~ '^[0-9a-f]{64}$' or p_result->>'version' is distinct from 'documents-rules-1' then raise exception 'Invalid processing result.';end if;
  p_result:=p_result||jsonb_build_object('duplicate_screening',jsonb_build_object('exact_matches',(select count(*) from public.lockd_verification_documents where id<>d.id and sha256=p_result->>'sha256'),'interpretation','A repeated upload is a review signal, not proof of fraud.'));
  insert into public.lockd_document_analyses(document_id,verification_case_id,result,version) values(d.id,c.id,p_result,p_result->>'version') on conflict(document_id) do nothing;
  update public.lockd_document_jobs set state='complete',lease_until=null where document_id=d.id;
  update public.lockd_verification_documents set state='screened',scanner_status='clean',sha256=p_result->>'sha256',retention_expires_at=c.expires_at where id=d.id;
  update public.lockd_verification_cases set state='needs_confirmation',version=version+1,updated_at=now() where id=c.id;
 end if;
 insert into public.lockd_document_audit(case_id,event,details) values(c.id,'sandbox_screening_processed',jsonb_build_object('document_id',d.id,'error_code',p_error));
 return true;
end $$;

create function public.submit_lockd_verification_case(p_case_id uuid,p_version integer,p_fields jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_verification_cases%rowtype; k text; v jsonb;
begin
 perform public.lockd_require_verification_sandbox();
 select * into c from public.lockd_verification_cases where id=p_case_id and user_id=auth.uid() for update;
 if not found or c.state not in ('needs_confirmation','additional_information') or c.version is distinct from p_version or c.withdrawn_at is not null or c.expires_at<=now() then raise exception 'Refresh this submission before continuing.';end if;
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>5000 then raise exception 'Invalid corrections.';end if;
 for k,v in select * from jsonb_each(p_fields) loop
  if k not in ('account_holder','service_address','issue_date','due_date','billing_period','statement_start','statement_end','currency','institution') or jsonb_typeof(v)<>'string' or length(v#>>'{}')>1000 then raise exception 'Invalid corrections.';end if;
 end loop;
 if exists(select 1 from public.lockd_verification_documents where verification_case_id=c.id and state not in ('screened','deleted')) then raise exception 'Wait for document processing before submitting.';end if;
 if 'financial'=any(c.required_checks) and not exists(select 1 from public.lockd_verification_documents where verification_case_id=c.id and evidence_kind=c.financial_method and state='screened') then raise exception 'Add your selected financial statement.';end if;
 if 'address'=any(c.required_checks) and not exists(select 1 from public.lockd_verification_documents where verification_case_id=c.id and evidence_kind not in ('mpesa','bank') and state='screened') then raise exception 'Add your address evidence.';end if;
 insert into public.lockd_document_corrections(verification_case_id,actor_id,version,fields) values(c.id,auth.uid(),c.version,p_fields);
 update public.lockd_verification_cases set state='under_review',version=version+1,updated_at=now() where id=c.id;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'sandbox_review_requested');
end $$;

create function public.transition_lockd_verification_case(p_case_id uuid,p_version integer,p_action text,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_verification_cases%rowtype;
begin
 select * into c from public.lockd_verification_cases where id=p_case_id for update;
 if not found or auth.uid() is null or c.version is distinct from p_version then raise exception 'Refresh this submission before continuing.';end if;
 if p_action='withdraw' then
  if c.user_id<>auth.uid() then raise exception 'Submission is unavailable.';end if;
  update public.lockd_verification_cases set state='withdrawn',withdrawn_at=now(),version=version+1,updated_at=now() where id=c.id;
  update public.lockd_verification_documents set state='deletion_pending' where verification_case_id=c.id and state<>'deleted';
  update public.lockd_document_jobs set state='cancelled',lease_token=null where document_id in(select id from public.lockd_verification_documents where verification_case_id=c.id);
 elsif p_action='appeal' then
  if c.user_id<>auth.uid() or c.state not in ('rejected','unable_to_verify') or c.appeal_used or c.expires_at<=now() or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A review request is unavailable.';end if;
  update public.lockd_verification_cases set state='under_review',appeal_used=true,version=version+1,updated_at=now() where id=c.id;
 else
  perform public.lockd_require_verification_sandbox(true);
  if c.user_id=auth.uid() or (c.appeal_used and c.reviewer_id=auth.uid()) then raise exception 'A different reviewer is required.';end if;
  if c.withdrawn_at is not null or c.expires_at<=now() or length(trim(coalesce(p_reason,''))) not between 10 and 2000 or p_action not in ('verified','unable_to_verify','rejected','additional_information','revoked') or (p_action<>'revoked' and c.state<>'under_review') or (p_action='revoked' and c.state<>'verified') then raise exception 'This verification change is not permitted.';end if;
  if p_action='verified' and ('identity'=any(c.required_checks) or 'credit'=any(c.required_checks) or 'fraud'=any(c.required_checks)) then raise exception 'Required provider checks must be reconciled before completion.';end if;
  update public.lockd_verification_cases set state=p_action,reviewer_id=auth.uid(),review_reason=trim(p_reason),version=version+1,updated_at=now() where id=c.id;
 end if;
 insert into public.lockd_document_audit(actor_id,case_id,event,details) values(auth.uid(),c.id,'sandbox_'||p_action,jsonb_build_object('reason',left(p_reason,2000)));
 -- Deliberately NO passport, booking, payout or payment writes.
end $$;

create function public.lockd_verification_review(p_case_id uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_verification_cases%rowtype;
begin
 perform public.lockd_require_verification_sandbox(true);
 if p_case_id is null then
  return coalesce((select jsonb_agg(to_jsonb(x)) from(select id,booking_id,state,required_checks,version,created_at from public.lockd_verification_cases where state='under_review' and expires_at>now() and withdrawn_at is null order by created_at limit 50)x),'[]');
 end if;
 select * into c from public.lockd_verification_cases where id=p_case_id and expires_at>now() and withdrawn_at is null;
 if not found then raise exception 'Submission is unavailable.';end if;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'sandbox_review_accessed');
 return jsonb_build_object('case',to_jsonb(c),'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.evidence_kind,'state',d.state,'analysis',a.result)) from public.lockd_verification_documents d left join public.lockd_document_analyses a on a.document_id=d.id where d.verification_case_id=c.id and d.retention_expires_at>now() and d.state='screened'),'[]'),
 'corrections',coalesce((select jsonb_agg(to_jsonb(x)) from public.lockd_document_corrections x where verification_case_id=c.id),'[]'),
 'audit',coalesce((select jsonb_agg(to_jsonb(x)) from (select event,created_at,actor_id from public.lockd_document_audit where case_id=c.id order by id desc limit 100)x),'[]'));
end $$;

alter function public.lockd_document_file_reference(uuid) rename to lockd_address_file_reference;
revoke all on function public.lockd_address_file_reference(uuid) from public,anon,authenticated,service_role;
create function public.lockd_document_file_reference(p_document_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype;
begin
 select * into d from public.lockd_verification_documents where id=p_document_id;
 if d.verification_case_id is null then return public.lockd_address_file_reference(p_document_id);end if;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id and expires_at>now() and withdrawn_at is null;
 if not found or auth.uid() is null or d.state<>'screened' or d.scanner_status<>'clean' or d.retention_expires_at<=now() then raise exception 'Document not found.';end if;
 if c.user_id<>auth.uid() then perform public.lockd_require_verification_sandbox(true);end if;
 insert into public.lockd_document_audit(actor_id,case_id,event,details) values(auth.uid(),c.id,'sandbox_original_accessed',jsonb_build_object('document_id',d.id));
 return jsonb_build_object('path',d.object_path,'mime',d.declared_mime,'bytes',d.byte_size);
end $$;
alter function public.purge_lockd_expired_address_cases() rename to lockd_purge_address_cases;
revoke all on function public.lockd_purge_address_cases() from public,anon,authenticated,service_role;
create function public.purge_lockd_expired_address_cases() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; c public.lockd_verification_cases%rowtype;
begin
 n:=public.lockd_purge_address_cases();
 for c in select * from public.lockd_verification_cases x where (expires_at<=now() or withdrawn_at is not null) and purpose<>'[removed]'
 and not exists(select 1 from public.lockd_verification_documents where verification_case_id=x.id and state<>'deleted') for update skip locked limit 50 loop
  delete from public.lockd_document_corrections where verification_case_id=c.id;
  update public.lockd_verification_cases set declared_address=null,review_reason=null,booking_snapshot=null,purpose='[removed]',state=case when state='withdrawn' then state else 'expired' end where id=c.id;
  insert into public.lockd_document_audit(case_id,event) values(c.id,'sandbox_sensitive_fields_expired');n:=n+1;
 end loop;
 return n;
end $$;

create function public.claim_lockd_credit_request(p_case_id uuid,p_provider text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_verification_cases%rowtype; r public.lockd_credit_requests%rowtype;
begin
 select * into c from public.lockd_verification_cases where id=p_case_id for update;
 if not found or c.withdrawn_at is not null or c.expires_at<=now() or c.state not in ('awaiting_upload','processing','needs_confirmation','under_review') or not ('credit'=any(c.required_checks))
 or p_provider is null or p_provider not in ('creditinfo','metropol') then raise exception 'Credit request unavailable.';end if;
 if not exists(select 1 from public.lockd_verification_settings where singleton and enabled and policy_approved_at is not null)
 or not exists(select 1 from public.lockd_verification_sandbox_members where user_id=c.user_id and expires_at>now())
 or not exists(select 1 from public.lockd_sandbox_rental_requirements where policy_id=c.policy_id and credit_purpose_approved)
 or not exists(select 1 from public.lockd_verification_consents where case_id=c.id and purpose='credit' and user_id=c.user_id) then raise exception 'Credit consent and approved purpose required.';end if;
 select * into r from public.lockd_credit_requests where case_id=c.id and provider=p_provider;
 if found then
  if r.state='processing' and r.updated_at<now()-interval '10 minutes' then update public.lockd_credit_requests set state='unknown',updated_at=now() where id=r.id;r.state:='unknown';end if;
  return jsonb_build_object('state',r.state,'retryAllowed',false);
 end if;
 insert into public.lockd_credit_requests(case_id,provider,state) values(c.id,p_provider,'processing') returning * into r;
 insert into public.lockd_document_audit(case_id,event,details) values(c.id,'sandbox_credit_requested',jsonb_build_object('request_id',r.id,'provider',p_provider));
 return jsonb_build_object('id',r.id,'state','claimed');
end $$;
create function public.finish_lockd_credit_request(p_id uuid,p_reference text,p_outcome text) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_credit_requests%rowtype;c public.lockd_verification_cases%rowtype;
begin
 select * into r from public.lockd_credit_requests where id=p_id and state='processing' for update;
 if not found then return false;end if;
 select * into c from public.lockd_verification_cases where id=r.case_id for update;
 if c.withdrawn_at is not null or c.expires_at<=now() then p_outcome:='unavailable';p_reference:=null;end if;
 if p_outcome is null or p_outcome not in ('received','unavailable','unknown') or (p_outcome='received' and coalesce(p_reference,'') !~ '^[0-9a-f-]{36}$') then raise exception 'Invalid credit result.';end if;
 update public.lockd_credit_requests set state=p_outcome,provider_reference=p_reference,updated_at=now() where id=r.id;
 insert into public.lockd_document_audit(case_id,event,details) values(c.id,'sandbox_credit_result',jsonb_build_object('request_id',r.id,'state',p_outcome));
 return true;
end $$;

do $$declare t text;f record;begin
 foreach t in array array['lockd_verification_settings','lockd_verification_sandbox_members','lockd_sandbox_rental_requirements','lockd_verification_cases','lockd_verification_consents','lockd_credit_requests'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);end loop;
 for f in select oid::regprocedure sig,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('lockd_require_verification_sandbox','lockd_verification_capabilities','lockd_verification_requirements','create_lockd_verification_case','my_lockd_verification_cases','reserve_lockd_verification_document','lockd_document_upload_allowed','queue_lockd_verification_document','claim_lockd_document_job','finish_lockd_document_job','submit_lockd_verification_case','transition_lockd_verification_case','lockd_verification_review','lockd_document_file_reference','purge_lockd_expired_address_cases','claim_lockd_credit_request','finish_lockd_credit_request') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 if f.proname in ('claim_lockd_document_job','finish_lockd_document_job','purge_lockd_expired_address_cases','claim_lockd_credit_request','finish_lockd_credit_request') then execute format('grant execute on function %s to service_role',f.sig);
 elsif f.proname<>'lockd_require_verification_sandbox' then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end $$;
commit;
