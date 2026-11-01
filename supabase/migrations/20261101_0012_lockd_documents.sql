-- Private supporting evidence. Disabled by default pending scanner, retention and legal review.
begin;
create table public.lockd_document_settings (
 singleton boolean primary key default true check(singleton), uploads_enabled boolean not null default false,
 retention_days integer not null default 30 check(retention_days between 1 and 90),
 consent_version text not null default 'address-evidence-1', policy_approved_at timestamptz
);
insert into public.lockd_document_settings(singleton) values(true);
create table public.lockd_address_cases (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 request_key uuid not null, method text not null check(method in ('utility','kra_certificate','tenancy','student','landlord','family','other')),
 declared_address text not null check(length(trim(declared_address)) between 5 and 1000),
 explanation text not null default '' check(length(explanation)<=2000),
 consent_version text not null, consent_at timestamptz not null default now(), withdrawn_at timestamptz,
 state text not null default 'draft' check(state in ('draft','processing','needs_confirmation','submitted','more_evidence','accepted','declined','withdrawn','expired')),
 version integer not null default 1, reviewer_id uuid references auth.users(id), review_reason text, appeal_used boolean not null default false, appeal_reason text,
 expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,request_key)
);
create table public.lockd_verification_documents (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.lockd_address_cases(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict, object_path text not null unique,
 declared_mime text not null check(declared_mime in ('application/pdf','image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 16 and 2097152),
 state text not null default 'reserved' check(state in ('reserved','quarantined','processing','screened','blocked','unavailable','deletion_pending','deleted')),
 sha256 text check(sha256 ~ '^[0-9a-f]{64}$'), scanner_status text not null default 'pending' check(scanner_status in ('pending','clean','blocked','unavailable')),
 retention_expires_at timestamptz not null, deletion_token uuid, deletion_lease_until timestamptz, created_at timestamptz not null default now()
);
create table public.lockd_document_analyses (
 id uuid primary key default gen_random_uuid(), document_id uuid not null unique references public.lockd_verification_documents(id) on delete restrict,
 case_id uuid not null references public.lockd_address_cases(id) on delete restrict,
 result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=262144),
 version text not null, created_at timestamptz not null default now()
);
create table public.lockd_document_corrections (
 id bigint generated always as identity primary key, case_id uuid not null references public.lockd_address_cases(id) on delete restrict,
 actor_id uuid not null references auth.users(id), version integer not null, fields jsonb not null,
 created_at timestamptz not null default now(), unique(case_id,version)
);
create table public.lockd_document_jobs (
 document_id uuid primary key references public.lockd_verification_documents(id), state text not null default 'pending' check(state in ('pending','processing','retry','complete','dead_letter','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 5), lease_token uuid, lease_until timestamptz,
 available_at timestamptz not null default now(), error_code text, created_at timestamptz not null default now()
);
create table public.lockd_document_audit (
 id bigint generated always as identity primary key, actor_id uuid, case_id uuid not null,
 event text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index lockd_address_user on public.lockd_address_cases(user_id,created_at desc);
create index lockd_document_due on public.lockd_document_jobs(state,available_at);
create index lockd_document_retention on public.lockd_verification_documents(retention_expires_at) where state<>'deleted';
create index lockd_document_duplicates on public.lockd_verification_documents(sha256) where sha256 is not null;
create trigger lockd_document_audit_immutable before update or delete on public.lockd_document_audit for each row execute function public.lockd_immutable_trust_record();

create function public.my_lockd_address_cases() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select c.id,c.method,c.declared_address,c.explanation,c.state,c.version,c.created_at,c.review_reason,c.expires_at,c.appeal_used,
 coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'scannerStatus',d.scanner_status,
 'fields',a.result->'fields','classification',a.result->'classification','issuerStatus','not_independently_verified'))
 from public.lockd_verification_documents d left join public.lockd_document_analyses a on a.document_id=d.id where d.case_id=c.id and d.state not in ('deleted','deletion_pending')),'[]') documents,
 (select fields from public.lockd_document_corrections where case_id=c.id order by version desc limit 1) corrected_fields
 from public.lockd_address_cases c where c.user_id=auth.uid() order by c.created_at desc limit 30)x),'[]');
end $$;
create function public.create_lockd_address_case(p_method text,p_address text,p_explanation text,p_consent text,p_request_key uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype; s public.lockd_document_settings%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
 select * into c from public.lockd_address_cases where user_id=auth.uid() and request_key=p_request_key;
 if found then return to_jsonb(c); end if;
 select * into s from public.lockd_document_settings where singleton;
 if s.policy_approved_at is null then raise exception 'Address submissions are not enabled yet.'; end if;
 if p_method is null or p_method not in ('utility','kra_certificate','tenancy','student','landlord','family','other') or length(trim(coalesce(p_address,''))) not between 5 and 1000
 or length(coalesce(p_explanation,''))>2000 or p_consent is distinct from s.consent_version or p_request_key is null then raise exception 'Invalid address evidence details.'; end if;
 if (select count(*) from public.lockd_address_cases where user_id=auth.uid() and created_at>now()-interval '1 day')>=5 then raise exception 'Please try again tomorrow.'; end if;
 insert into public.lockd_address_cases(user_id,request_key,method,declared_address,explanation,consent_version,expires_at)
 values(auth.uid(),p_request_key,p_method,trim(p_address),coalesce(trim(p_explanation),''),p_consent,now()+make_interval(days=>s.retention_days)) returning * into c;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'consent_recorded');
 return to_jsonb(c);
end $$;
create function public.reserve_lockd_document(p_case_id uuid,p_mime text,p_bytes integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype; d public.lockd_verification_documents%rowtype; did uuid:=gen_random_uuid();
begin
 select * into c from public.lockd_address_cases where id=p_case_id and user_id=auth.uid() for update;
 if not found or c.state not in ('draft','more_evidence') or c.withdrawn_at is not null or c.expires_at<=now() then raise exception 'Address evidence is unavailable.'; end if;
 if not exists(select 1 from public.lockd_document_settings where singleton and uploads_enabled and policy_approved_at is not null) then raise exception 'Document uploads are not enabled yet.'; end if;
 if (select count(*) from public.lockd_verification_documents where case_id=c.id)>=3 then raise exception 'Document limit reached.'; end if;
 insert into public.lockd_verification_documents(id,case_id,user_id,object_path,declared_mime,byte_size,retention_expires_at)
 values(did,c.id,auth.uid(),auth.uid()::text||'/'||c.id::text||'/'||did::text,p_mime,p_bytes,least(c.expires_at,now()+interval '1 day')) returning * into d;
 return jsonb_build_object('id',d.id,'path',d.object_path,'bucket','lockd-verification-private');
end $$;
create function public.lockd_document_upload_allowed(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.lockd_verification_documents d join public.lockd_address_cases c on c.id=d.case_id
 join public.lockd_document_settings s on s.singleton where d.object_path=p_path and d.user_id=auth.uid() and c.user_id=auth.uid()
 and d.state='reserved' and d.created_at>now()-interval '15 minutes' and c.withdrawn_at is null and c.expires_at>now() and s.uploads_enabled and s.policy_approved_at is not null)
$$;
create function public.queue_lockd_document(p_document_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype;
begin
 select * into d from public.lockd_verification_documents where id=p_document_id and user_id=auth.uid() for update;
 if not found then raise exception 'Document not found.'; end if;
 if d.state<>'reserved' then return; end if;
 if not public.lockd_document_upload_allowed(d.object_path) then raise exception 'Address evidence is unavailable.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='lockd-verification-private' and name=d.object_path and coalesce(metadata->>'size','0')::bigint=d.byte_size) then raise exception 'Upload is incomplete.'; end if;
 update public.lockd_verification_documents set state='quarantined' where id=d.id;
 insert into public.lockd_document_jobs(document_id) values(d.id) on conflict do nothing;
 update public.lockd_address_cases set state='processing',updated_at=now() where id=d.case_id;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),d.case_id,'document_quarantined');
end $$;
create function public.claim_lockd_document_job() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.lockd_document_jobs%rowtype; d public.lockd_verification_documents%rowtype;
begin
 -- One bounded processor globally. Durable leases survive Render restarts.
 perform pg_advisory_xact_lock(1212012);
 if exists(select 1 from public.lockd_document_jobs where state='processing' and lease_until>now()) then return null; end if;
 update public.lockd_document_jobs set state='dead_letter',error_code='retry_limit' where attempts>=5 and state in ('retry','processing') and coalesce(lease_until,available_at)<=now();
 select x.* into j from public.lockd_document_jobs x join public.lockd_verification_documents y on y.id=x.document_id join public.lockd_address_cases c on c.id=y.case_id
 where c.withdrawn_at is null and c.expires_at>now() and y.state not in ('deletion_pending','deleted','blocked') and y.retention_expires_at>now()
 and x.attempts<5 and ((x.state in ('pending','retry') and x.available_at<=now()) or (x.state='processing' and x.lease_until<=now())) order by x.available_at for update of x skip locked limit 1;
 if not found then return null; end if;
 update public.lockd_document_jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where document_id=j.document_id returning * into j;
 update public.lockd_verification_documents set state='processing' where id=j.document_id returning * into d;
 return jsonb_build_object('document_id',d.id,'path',d.object_path,'mime',d.declared_mime,'byte_size',d.byte_size,'lease_token',j.lease_token,'declared_address',(select declared_address from public.lockd_address_cases where id=d.case_id));
end $$;
create function public.finish_lockd_document_job(p_document_id uuid,p_lease_token uuid,p_result jsonb,p_error text default null) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_address_cases%rowtype; j public.lockd_document_jobs%rowtype;
begin
 select * into j from public.lockd_document_jobs where document_id=p_document_id and state='processing' and lease_token=p_lease_token and lease_until>now() for update;
 if not found then return false; end if;
 select * into d from public.lockd_verification_documents where id=p_document_id for update;
 select * into c from public.lockd_address_cases where id=d.case_id for update;
 if c.withdrawn_at is not null or c.expires_at<=now() or d.state in ('deleted','deletion_pending') then
 update public.lockd_document_jobs set state='cancelled' where document_id=d.id; return false; end if;
 if p_error is not null then
 if p_error not in ('scanner_unavailable','unsafe_file','analysis_unavailable','storage_unavailable') then raise exception 'Invalid processing result.'; end if;
 update public.lockd_document_jobs set state=case when attempts>=5 or p_error='unsafe_file' then 'dead_letter' else 'retry' end,error_code=p_error,available_at=now()+make_interval(secs=>least(1800,30*(2^attempts)::integer)),lease_until=null where document_id=d.id;
 update public.lockd_verification_documents set state=case when p_error='unsafe_file' then 'blocked' else 'unavailable' end,scanner_status=case when p_error='unsafe_file' then 'blocked' when p_error='scanner_unavailable' then 'unavailable' else scanner_status end where id=d.id;
 update public.lockd_address_cases set state='more_evidence',updated_at=now() where id=c.id;
 else
 if p_result is null or p_result->>'issuer_status' is distinct from 'not_independently_verified' or p_result->>'trained_model' is distinct from 'false' or coalesce(p_result->>'sha256','') !~ '^[0-9a-f]{64}$' or p_result->>'version' is distinct from 'documents-rules-1' then raise exception 'Invalid processing result.'; end if;
 p_result:=p_result||jsonb_build_object('duplicate_screening',jsonb_build_object('exact_matches',(select count(*) from public.lockd_verification_documents where id<>d.id and sha256=p_result->>'sha256'),'interpretation','Repeated documents may be legitimate resubmissions; a match is not a fraud finding.'));
 insert into public.lockd_document_analyses(document_id,case_id,result,version) values(d.id,c.id,p_result,p_result->>'version') on conflict(document_id) do nothing;
 update public.lockd_document_jobs set state='complete',lease_until=null where document_id=d.id;
 update public.lockd_verification_documents set state='screened',scanner_status='clean',sha256=p_result->>'sha256',retention_expires_at=c.expires_at where id=d.id;
 update public.lockd_address_cases set state='needs_confirmation',version=version+1,updated_at=now() where id=c.id;
 end if;
 insert into public.lockd_document_audit(case_id,event,details) values(c.id,'screening_processed',jsonb_build_object('document_id',d.id,'error_code',p_error));
 return true;
end $$;
create function public.submit_lockd_address_case(p_case_id uuid,p_version integer,p_fields jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype; k text; v jsonb;
begin
 select * into c from public.lockd_address_cases where id=p_case_id and user_id=auth.uid() for update;
 if not found or c.withdrawn_at is not null or c.expires_at<=now() or c.state not in ('draft','needs_confirmation','more_evidence') or c.version is distinct from p_version then raise exception 'Refresh your address evidence before continuing.'; end if;
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>5000 then raise exception 'Invalid address fields.'; end if;
 for k,v in select * from jsonb_each(p_fields) loop
 if k not in ('account_holder','service_address','issue_date','due_date','billing_period') or jsonb_typeof(v)<>'string' or length(v#>>'{}')>1000 then raise exception 'Invalid address fields.'; end if;
 end loop;
 insert into public.lockd_document_corrections(case_id,actor_id,version,fields) values(c.id,auth.uid(),c.version,p_fields);
 update public.lockd_address_cases set state='submitted',version=version+1,updated_at=now() where id=c.id;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'review_requested');
end $$;
create function public.withdraw_lockd_address_case(p_case_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype;
begin
 select * into c from public.lockd_address_cases where id=p_case_id and user_id=auth.uid() for update;
 if not found then raise exception 'Address evidence is unavailable.'; end if;
 update public.lockd_address_cases set withdrawn_at=now(),state='withdrawn',version=version+1,updated_at=now() where id=c.id;
 update public.lockd_document_jobs set state='cancelled',lease_token=null,lease_until=null where document_id in(select id from public.lockd_verification_documents where case_id=c.id);
 update public.lockd_verification_documents set state='deletion_pending' where case_id=c.id and state<>'deleted';
 -- Revoke an accepted address reference without bypassing identity or other rental requirements.
 if c.state='accepted' and (select evidence_reference from public.lockd_verification_passport where user_id=c.user_id and kind='address' and environment='production' order by record_sequence desc limit 1)='address-case:'||c.id then
 insert into public.lockd_verification_passport(user_id,kind,outcome,environment,source,evidence_reference,verified_at,expires_at,recorded_by)
 values(c.user_id,'address','revoked','production','manual_review','address-case:'||c.id,now(),now()+interval '1 second',auth.uid());
 end if;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'consent_withdrawn');
end $$;
create function public.review_lockd_address_case(p_case_id uuid,p_version integer,p_decision text,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype;
begin
 perform public.lockd_require_trust_admin();
 select * into c from public.lockd_address_cases where id=p_case_id for update;
 if not found or c.state<>'submitted' or c.withdrawn_at is not null or c.expires_at<=now() or c.version is distinct from p_version then raise exception 'Address evidence is unavailable.'; end if;
 if c.user_id=auth.uid() then raise exception 'A different reviewer is required.'; end if;
 if c.appeal_used and c.reviewer_id=auth.uid() then raise exception 'A different reviewer is required.'; end if;
 if p_decision is null or p_decision not in ('accepted','more_evidence','declined') or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A review decision and reason are required.'; end if;
 if exists(select 1 from public.lockd_verification_documents where case_id=c.id and state not in ('screened','deleted')) then raise exception 'Document screening must finish before review.'; end if;
 update public.lockd_address_cases set state=p_decision,reviewer_id=auth.uid(),review_reason=trim(p_reason),version=version+1,updated_at=now() where id=c.id;
 if p_decision='accepted' then
 insert into public.lockd_verification_passport(user_id,kind,outcome,source,environment,evidence_reference,expires_at,recorded_by)
 values(c.user_id,'address','verified','manual_review','production','address-case:'||c.id,c.expires_at,auth.uid());
 end if;
 insert into public.lockd_document_audit(actor_id,case_id,event,details) values(auth.uid(),c.id,'human_review',jsonb_build_object('decision',p_decision));
end $$;
create function public.appeal_lockd_address_case(p_case_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype;
begin
 select * into c from public.lockd_address_cases where id=p_case_id and user_id=auth.uid() for update;
 if not found or c.state<>'declined' or c.appeal_used or c.withdrawn_at is not null or c.expires_at<=now() or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'An appeal is unavailable for this submission.'; end if;
 update public.lockd_address_cases set state='submitted',appeal_used=true,appeal_reason=trim(p_reason),version=version+1,updated_at=now() where id=c.id;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'appeal_requested');
end $$;

create function public.lockd_document_capabilities() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('submissionsEnabled',policy_approved_at is not null,'uploadsEnabled',uploads_enabled and policy_approved_at is not null,'consentVersion',consent_version,'retentionDays',retention_days,'kraEnabled',false) from public.lockd_document_settings where singleton
$$;
create function public.lockd_document_file_reference(p_document_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_address_cases%rowtype;
begin
 select * into d from public.lockd_verification_documents where id=p_document_id and state='screened' and scanner_status='clean' and retention_expires_at>now();
 if not found then raise exception 'Document not found.'; end if;
 select * into c from public.lockd_address_cases where id=d.case_id and withdrawn_at is null and expires_at>now();
 if not found or auth.uid() is null or (c.user_id<>auth.uid() and coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin') then raise exception 'Document not found.'; end if;
 insert into public.lockd_document_audit(actor_id,case_id,event,details) values(auth.uid(),c.id,'original_accessed',jsonb_build_object('document_id',d.id));
 return jsonb_build_object('path',d.object_path,'mime',d.declared_mime,'bytes',d.byte_size);
end $$;
create function public.claim_lockd_document_deletion() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype;
begin
 select * into d from public.lockd_verification_documents where (state='deletion_pending' or (state<>'deleted' and retention_expires_at<=now())) and coalesce(deletion_lease_until,'-infinity')<=now() order by retention_expires_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.lockd_verification_documents set state='deletion_pending',deletion_token=gen_random_uuid(),deletion_lease_until=now()+interval '60 seconds' where id=d.id returning * into d;
 update public.lockd_document_jobs set state='cancelled',lease_token=null where document_id=d.id;
 return jsonb_build_object('document_id',d.id,'path',d.object_path,'token',d.deletion_token);
end $$;
create function public.finish_lockd_document_deletion(p_document_id uuid,p_token uuid) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype;
begin
 select * into d from public.lockd_verification_documents where id=p_document_id and state='deletion_pending' and deletion_token=p_token and deletion_lease_until>now() for update;
 if not found then return false; end if;
 delete from public.lockd_document_analyses where document_id=d.id;
 update public.lockd_verification_documents set state='deleted',sha256=null,deletion_token=null,deletion_lease_until=null where id=d.id;
 if not exists(select 1 from public.lockd_verification_documents where case_id=d.case_id and state<>'deleted') then
 delete from public.lockd_document_corrections where case_id=d.case_id;
 update public.lockd_address_cases set declared_address='[removed]',explanation='',review_reason=null,appeal_reason=null,state=case when state='withdrawn' then state else 'expired' end where id=d.case_id;
 end if;
 insert into public.lockd_document_audit(case_id,event,details) values(d.case_id,'document_deleted',jsonb_build_object('document_id',d.id));
 return true;
end $$;
create function public.purge_lockd_expired_address_cases() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype; n integer:=0;
begin
 for c in select * from public.lockd_address_cases x where (expires_at<=now() or withdrawn_at is not null) and declared_address<>'[removed]' and not exists(select 1 from public.lockd_verification_documents where case_id=x.id and state<>'deleted') order by expires_at for update skip locked limit 50 loop
 delete from public.lockd_document_corrections where case_id=c.id;
 update public.lockd_address_cases set declared_address='[removed]',explanation='',review_reason=null,appeal_reason=null,state=case when state='withdrawn' then state else 'expired' end where id=c.id;
 insert into public.lockd_document_audit(case_id,event) values(c.id,'sensitive_fields_expired');n:=n+1;
 end loop;
 return n;
end $$;
create function public.lockd_address_review_queue() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.lockd_require_trust_admin();
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,method,state,version,created_at,expires_at from public.lockd_address_cases where state='submitted' and withdrawn_at is null and expires_at>now() order by created_at limit 50)x),'[]');
end $$;
create function public.lockd_address_review_detail(p_case_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_address_cases%rowtype;
begin
 perform public.lockd_require_trust_admin();
 select * into c from public.lockd_address_cases where id=p_case_id and withdrawn_at is null and expires_at>now();
 if not found then raise exception 'Address evidence is unavailable.'; end if;
 insert into public.lockd_document_audit(actor_id,case_id,event) values(auth.uid(),c.id,'review_accessed');
 return jsonb_build_object('case',to_jsonb(c),'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'analysis',a.result)) from public.lockd_verification_documents d left join public.lockd_document_analyses a on a.document_id=d.id where d.case_id=c.id),'[]'),
 'corrections',coalesce((select jsonb_agg(to_jsonb(x)) from public.lockd_document_corrections x where case_id=c.id),'[]'),
 'audit',coalesce((select jsonb_agg(to_jsonb(x)) from (select event,created_at,actor_id,details from public.lockd_document_audit where case_id=c.id order by id desc limit 100)x),'[]'));
end $$;

do $$declare t text; f record;begin
 foreach t in array array['lockd_document_settings','lockd_address_cases','lockd_verification_documents','lockd_document_analyses','lockd_document_corrections','lockd_document_jobs','lockd_document_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname in ('lockd_document_file_reference','purge_lockd_expired_address_cases','lockd_document_capabilities','claim_lockd_document_deletion','finish_lockd_document_deletion','my_lockd_address_cases','create_lockd_address_case','reserve_lockd_document','lockd_document_upload_allowed','queue_lockd_document','claim_lockd_document_job','finish_lockd_document_job','submit_lockd_address_case','withdraw_lockd_address_case','review_lockd_address_case','lockd_address_review_queue','lockd_address_review_detail') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 end loop;
end $$;
grant execute on function public.my_lockd_address_cases(),public.create_lockd_address_case(text,text,text,text,uuid),public.reserve_lockd_document(uuid,text,integer),public.lockd_document_upload_allowed(text),public.queue_lockd_document(uuid),public.submit_lockd_address_case(uuid,integer,jsonb),public.withdraw_lockd_address_case(uuid),public.review_lockd_address_case(uuid,integer,text,text),public.lockd_address_review_queue(),public.lockd_address_review_detail(uuid) to authenticated;
grant execute on function public.claim_lockd_document_job(),public.finish_lockd_document_job(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.claim_lockd_document_deletion(),public.finish_lockd_document_deletion(uuid,uuid) to service_role;
grant execute on function public.purge_lockd_expired_address_cases() to service_role;
grant execute on function public.lockd_document_capabilities() to authenticated;
grant execute on function public.lockd_document_file_reference(uuid) to authenticated;
revoke all on function public.appeal_lockd_address_case(uuid,text) from public,anon,authenticated;
grant execute on function public.appeal_lockd_address_case(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lockd-verification-private','lockd-verification-private',false,2097152,array['application/pdf','image/jpeg','image/png','image/webp']);
-- Upload-only quarantine: clients cannot read or overwrite originals, even their own.
create policy lockd_document_quarantine_insert on storage.objects for insert to authenticated with check(bucket_id='lockd-verification-private' and public.lockd_document_upload_allowed(name));
commit;
