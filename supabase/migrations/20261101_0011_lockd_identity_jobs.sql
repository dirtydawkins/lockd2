-- Persona remains disabled until configured. No raw webhook payloads, ID images or biometrics.
begin;
create table public.lockd_identity_attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 environment text not null check(environment in ('sandbox','production')),
 inquiry_id text unique check(inquiry_id ~ '^inq_[A-Za-z0-9]+$'),
 provider_status text, provider_updated_at timestamptz,
 consent_version text not null check(length(consent_version) between 1 and 80),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index lockd_identity_user on public.lockd_identity_attempts(user_id,created_at desc);
create table public.lockd_identity_jobs (
 event_id text primary key check(event_id ~ '^evt_[A-Za-z0-9]+$'),
 attempt_id uuid not null references public.lockd_identity_attempts(id) on delete restrict,
 event_created_at timestamptz not null, payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'pending' check(state in ('pending','processing','complete','retry','dead_letter')),
 attempts integer not null default 0 check(attempts between 0 and 8),
 available_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid,
 last_error_code text check(last_error_code in ('provider_unavailable','ownership_mismatch','invalid_response')),
 received_at timestamptz not null default now(), finished_at timestamptz
);
create index lockd_identity_jobs_due on public.lockd_identity_jobs(state,available_at);
alter table public.lockd_identity_attempts enable row level security;
alter table public.lockd_identity_jobs enable row level security;
revoke all on public.lockd_identity_attempts,public.lockd_identity_jobs from public,anon,authenticated;

create function public.begin_lockd_identity_attempt(p_environment text,p_consent_version text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.lockd_identity_attempts%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Sign in with a verified account.'; end if;
 if p_environment is null or p_environment not in ('sandbox','production') or length(trim(coalesce(p_consent_version,''))) not between 1 and 80 then raise exception 'Verification consent is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('identity:'||auth.uid()::text,0));
 select * into a from public.lockd_identity_attempts where user_id=auth.uid() and environment=p_environment and created_at>now()-interval '24 hours'
 and coalesce(provider_status,'created') in ('created','pending','needs_review') order by created_at desc limit 1;
 if found then return to_jsonb(a); end if;
 if (select count(*) from public.lockd_identity_attempts where user_id=auth.uid() and created_at>now()-interval '24 hours')>=5 then raise exception 'Please wait before starting another verification.'; end if;
 insert into public.lockd_identity_attempts(user_id,environment,consent_version) values(auth.uid(),p_environment,p_consent_version) returning * into a;
 return to_jsonb(a);
end $$;
create function public.link_lockd_identity_inquiry(p_attempt_id uuid,p_inquiry_id text,p_reference_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.lockd_identity_attempts%rowtype;
begin
 select * into a from public.lockd_identity_attempts where id=p_attempt_id for update;
 if not found or a.id is distinct from p_reference_id or (a.inquiry_id is not null and a.inquiry_id is distinct from p_inquiry_id) then raise exception 'Inquiry ownership mismatch.'; end if;
 update public.lockd_identity_attempts set inquiry_id=p_inquiry_id,updated_at=now() where id=a.id;
end $$;
create function public.enqueue_lockd_identity_event(p_event_id text,p_inquiry_id text,p_environment text,p_created_at timestamptz,p_sha256 text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare aid uuid; existing public.lockd_identity_jobs%rowtype;
begin
 select id into aid from public.lockd_identity_attempts where inquiry_id=p_inquiry_id and environment=p_environment;
 if not found then raise exception 'Inquiry ownership mismatch.'; end if;
 if p_created_at is null or p_created_at>now()+interval '5 minutes' then raise exception 'Invalid event time.'; end if;
 insert into public.lockd_identity_jobs(event_id,attempt_id,event_created_at,payload_sha256) values(p_event_id,aid,p_created_at,p_sha256) on conflict(event_id) do nothing;
 select * into existing from public.lockd_identity_jobs where event_id=p_event_id;
 if existing.attempt_id is distinct from aid or existing.event_created_at is distinct from p_created_at then raise exception 'Event reference collision.'; end if;
end $$;
create function public.claim_lockd_identity_job() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.lockd_identity_jobs%rowtype; a public.lockd_identity_attempts%rowtype;
begin
 update public.lockd_identity_jobs set state='dead_letter',lease_token=null,lease_until=null where state='processing' and lease_until<=now() and attempts>=8;
 select * into j from public.lockd_identity_jobs where attempts<8 and ((state in ('pending','retry') and available_at<=now()) or (state='processing' and lease_until<=now()))
 order by available_at,received_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.lockd_identity_jobs set state='processing',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid() where event_id=j.event_id returning * into j;
 select * into a from public.lockd_identity_attempts where id=j.attempt_id;
 return jsonb_build_object('eventId',j.event_id,'leaseToken',j.lease_token,'inquiryId',a.inquiry_id,'attemptId',a.id,'environment',a.environment);
end $$;
create function public.finish_lockd_identity_job(p_event_id text,p_lease_token uuid,p_inquiry_id text,p_reference_id uuid,p_status text,p_provider_updated_at timestamptz,p_valid_days integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.lockd_identity_jobs%rowtype; a public.lockd_identity_attempts%rowtype; outcome text;
begin
 select * into j from public.lockd_identity_jobs where event_id=p_event_id for update;
 if not found or j.state<>'processing' or j.lease_token is distinct from p_lease_token or j.lease_until<=now() then raise exception 'Job lease expired.'; end if;
 select * into a from public.lockd_identity_attempts where id=j.attempt_id for update;
 if a.id is distinct from p_reference_id or a.inquiry_id is distinct from p_inquiry_id then raise exception 'Inquiry ownership mismatch.'; end if;
 if p_status is null or p_status not in ('created','pending','completed','failed','expired','needs_review','approved','declined')
 or p_provider_updated_at is null or p_provider_updated_at>now()+interval '5 minutes' or p_valid_days is null or p_valid_days not between 1 and 365 then raise exception 'Invalid provider result.'; end if;
 if a.provider_updated_at is null or p_provider_updated_at>a.provider_updated_at then
  outcome:=case when p_status='approved' then 'verified' when p_status in ('declined','failed','expired') then 'revoked' else 'review_required' end;
  if outcome='verified' and (select v.outcome='revoked' from public.lockd_verification_passport v where v.user_id=a.user_id and v.kind='identity' and v.environment=a.environment and v.source='manual_review' order by v.record_sequence desc limit 1) then outcome:='review_required'; end if;
  -- Completed is NOT a platform approval. Sandbox can never satisfy production policy checks.
  insert into public.lockd_verification_passport(user_id,kind,outcome,source,environment,evidence_reference,expires_at)
  values(a.user_id,'identity',outcome,'persona',a.environment,a.inquiry_id,now()+make_interval(days=>p_valid_days));
  update public.lockd_identity_attempts set provider_status=p_status,provider_updated_at=p_provider_updated_at,updated_at=now() where id=a.id;
  insert into public.lockd_trust_audit(event_type,details) values('persona_result_reconciled',jsonb_build_object('attemptId',a.id,'environment',a.environment,'outcome',outcome));
 elsif p_provider_updated_at=a.provider_updated_at and p_status is distinct from a.provider_status then raise exception 'Conflicting provider result.'; end if;
 update public.lockd_identity_jobs set state='complete',finished_at=now(),lease_token=null,lease_until=null,last_error_code=null where event_id=j.event_id;
end $$;
create function public.retry_lockd_identity_job(p_event_id text,p_lease_token uuid,p_error_code text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_error_code is null or p_error_code not in ('provider_unavailable','ownership_mismatch','invalid_response') then raise exception 'Invalid job error.'; end if;
 update public.lockd_identity_jobs set state=case when attempts>=8 or p_error_code='ownership_mismatch' then 'dead_letter' else 'retry' end,
 available_at=now()+make_interval(secs=>least(3600,power(2,attempts)::integer*30)),last_error_code=p_error_code,lease_token=null,lease_until=null
 where event_id=p_event_id and state='processing' and lease_token=p_lease_token and lease_until>now();
 if not found then raise exception 'Job lease expired.'; end if;
end $$;
revoke all on function public.begin_lockd_identity_attempt(text,text),public.link_lockd_identity_inquiry(uuid,text,uuid),public.enqueue_lockd_identity_event(text,text,text,timestamptz,text),public.claim_lockd_identity_job(),public.finish_lockd_identity_job(text,uuid,text,uuid,text,timestamptz,integer),public.retry_lockd_identity_job(text,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_lockd_identity_attempt(text,text) to authenticated;
grant execute on function public.link_lockd_identity_inquiry(uuid,text,uuid),public.enqueue_lockd_identity_event(text,text,text,timestamptz,text),public.claim_lockd_identity_job(),public.finish_lockd_identity_job(text,uuid,text,uuid,text,timestamptz,integer),public.retry_lockd_identity_job(text,uuid,text) to service_role;
commit;
