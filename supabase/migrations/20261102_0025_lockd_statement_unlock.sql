-- Passwords never enter PostgreSQL, storage, queue payloads or audit details.
begin;
alter table public.lockd_verification_documents add column unlock_attempts integer not null default 0 check(unlock_attempts between 0 and 5), add column unlock_attempted_at timestamptz;

alter function public.finish_lockd_document_job(uuid,uuid,jsonb,text) rename to lockd_finish_document_before_unlock;
revoke all on function public.lockd_finish_document_before_unlock(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
create function public.finish_lockd_document_job(p_document_id uuid,p_lease_token uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype;
begin
 if p_error is distinct from 'password_required' then return public.lockd_finish_document_before_unlock(p_document_id,p_lease_token,p_result,p_error);end if;
 perform 1 from public.lockd_document_jobs where document_id=p_document_id and state='processing' and lease_token=p_lease_token and lease_until>now() for update;
 if not found then return false;end if;
 select * into d from public.lockd_verification_documents where id=p_document_id for update;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id for update;
 if not found or d.evidence_kind not in ('mpesa','bank') or d.declared_mime<>'application/pdf' then
  return public.lockd_finish_document_before_unlock(p_document_id,p_lease_token,null,'unsafe_file');
 end if;
 if c.withdrawn_at is not null or c.expires_at<=now() or d.retention_expires_at<=now() or d.state in ('deleted','deletion_pending') then
  update public.lockd_document_jobs set state='cancelled',lease_token=null,lease_until=null where document_id=d.id;return false;
 end if;
 update public.lockd_document_jobs set state='dead_letter',error_code='password_required',lease_token=null,lease_until=null where document_id=d.id;
 update public.lockd_verification_documents set state='unavailable',scanner_status='clean' where id=d.id;
 update public.lockd_verification_cases set state='additional_information',version=version+1,updated_at=now() where id=c.id;
 insert into public.lockd_document_audit(case_id,event,details) values(c.id,'statement_password_needed',jsonb_build_object('document_id',d.id));
 return true;
end $$;

-- Caller identity authorizes the lease before the ephemeral password is forwarded.
create function public.claim_lockd_statement_unlock(p_document_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype; j public.lockd_document_jobs%rowtype;
begin
 perform public.lockd_require_verification_sandbox();
 select * into j from public.lockd_document_jobs where document_id=p_document_id for update;
 if not found then raise exception 'Statement is unavailable.';end if;
 select * into d from public.lockd_verification_documents where id=p_document_id and user_id=auth.uid() for update;
 if not found then raise exception 'Statement is unavailable.';end if;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id for update;
 if not found or c.user_id<>auth.uid() or c.withdrawn_at is not null or c.expires_at<=now()
 or c.state not in ('processing','additional_information','needs_confirmation') or d.retention_expires_at<=now()
 or d.evidence_kind not in ('mpesa','bank') or d.declared_mime<>'application/pdf' or d.unlock_attempts>=5
 or not exists(select 1 from public.lockd_verification_settings where singleton and enabled and uploads_enabled and policy_approved_at is not null)
 or not exists(select 1 from public.lockd_verification_consents where case_id=c.id and purpose='processing' and user_id=auth.uid())
 or d.unlock_attempted_at>now()-interval '30 seconds'
 or j.error_code is distinct from 'password_required'
 or not coalesce(j.state='dead_letter' or (j.state='processing' and j.lease_until<=now()),false) then raise exception 'Statement cannot be unlocked right now.';end if;
 update public.lockd_document_jobs set state='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where document_id=d.id returning * into j;
 update public.lockd_verification_documents set unlock_attempts=unlock_attempts+1,unlock_attempted_at=now(),state='processing' where id=d.id;
 insert into public.lockd_document_audit(actor_id,case_id,event,details) values(auth.uid(),c.id,'statement_unlock_requested',jsonb_build_object('document_id',d.id));
 return jsonb_build_object('documentId',d.id,'lease',j.lease_token);
end $$;

create function public.lockd_statement_unlock_context(p_document_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype;
begin
 perform 1 from public.lockd_document_jobs where document_id=p_document_id and state='processing' and error_code='password_required' and lease_token=p_lease and lease_until>now();
 if not found then raise exception 'Statement lease expired.';end if;
 select * into d from public.lockd_verification_documents where id=p_document_id;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id;
 if not found or c.withdrawn_at is not null or c.expires_at<=now() or d.retention_expires_at<=now() or d.state<>'processing'
 or d.evidence_kind not in ('mpesa','bank') or d.declared_mime<>'application/pdf'
 or not exists(select 1 from public.lockd_verification_sandbox_members where user_id=c.user_id and expires_at>now())
 or not exists(select 1 from public.lockd_verification_settings where singleton and enabled and uploads_enabled and policy_approved_at is not null) then raise exception 'Statement is unavailable.';end if;
 return jsonb_build_object('document_id',d.id,'lease_token',p_lease,'path',d.object_path,'byte_size',d.byte_size,'mime',d.declared_mime,'method',d.evidence_kind,'declared_address',coalesce(c.declared_address,''),
 'booking_obligation',(select total_amount::text from public.lockd_bookings where id=c.booking_id and customer_id=c.user_id),
 'booking_currency',(select currency from public.lockd_bookings where id=c.booking_id and customer_id=c.user_id));
end $$;

create or replace function public.my_lockd_verification_cases() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select c.id,c.booking_id,c.required_checks,c.financial_method,c.purpose,c.environment,c.version,c.review_reason,c.created_at,c.expires_at,c.appeal_used,
 case when c.expires_at<=now() and c.state not in ('withdrawn','revoked') then 'expired' else c.state end state,
 case when c.expires_at>now() then c.declared_address end declared_address,
 coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.evidence_kind,'state',d.state,
 'passwordNeeded',j.error_code='password_required' and d.unlock_attempts<5 and (j.state='dead_letter' or (j.state='processing' and j.lease_until<=now())),
 'fields',case when d.state='screened' then a.result->'fields' end,'summary',case when d.state='screened' then a.result->'financial'->'summary' end))
 from public.lockd_verification_documents d left join public.lockd_document_analyses a on a.document_id=d.id left join public.lockd_document_jobs j on j.document_id=d.id
 where d.verification_case_id=c.id and d.state in ('screened','unavailable','processing') and d.retention_expires_at>now() and c.expires_at>now() and c.withdrawn_at is null),'[]') documents
 from public.lockd_verification_cases c where c.user_id=auth.uid() order by c.created_at desc limit 30)x),'[]');
end $$;
revoke all on function public.finish_lockd_document_job(uuid,uuid,jsonb,text),public.claim_lockd_statement_unlock(uuid),public.lockd_statement_unlock_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_lockd_document_job(uuid,uuid,jsonb,text),public.lockd_statement_unlock_context(uuid,uuid) to service_role;
grant execute on function public.claim_lockd_statement_unlock(uuid) to authenticated;
commit;
