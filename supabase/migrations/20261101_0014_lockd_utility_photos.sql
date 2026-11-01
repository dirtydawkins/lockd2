-- Utility-only restriction. Other evidence keeps its existing PDF/image policy.
begin;
create function public.lockd_require_utility_photo() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.lockd_address_cases where id=new.case_id and method='utility')
 and new.declared_mime not in ('image/jpeg','image/png','image/webp') then
  raise exception 'Utility bills require a JPG, PNG or WebP photograph.';
 end if;
 return new;
end $$;
create trigger lockd_utility_photo_policy before insert or update of case_id,declared_mime on public.lockd_verification_documents for each row execute function public.lockd_require_utility_photo();
revoke all on function public.lockd_require_utility_photo() from public,anon,authenticated;
create or replace function public.lockd_document_upload_allowed(p_path text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.lockd_verification_documents d join public.lockd_address_cases c on c.id=d.case_id
 join public.lockd_document_settings s on s.singleton where d.object_path=p_path and d.user_id=auth.uid() and c.user_id=auth.uid()
 and d.state='reserved' and d.created_at>now()-interval '15 minutes' and c.withdrawn_at is null and c.expires_at>now() and s.uploads_enabled and s.policy_approved_at is not null
 and (c.method<>'utility' or d.declared_mime in ('image/jpeg','image/png','image/webp')))
$$;
-- Preserve leased job logic; add the authoritative workflow to the worker contract.
alter function public.claim_lockd_document_job() rename to lockd_claim_document_job_v1;
revoke all on function public.lockd_claim_document_job_v1() from public,anon,authenticated,service_role;
create function public.claim_lockd_document_job() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j jsonb; m text;
begin
 j:=public.lockd_claim_document_job_v1(); if j is null then return null; end if;
 select c.method into m from public.lockd_verification_documents d join public.lockd_address_cases c on c.id=d.case_id where d.id=(j->>'document_id')::uuid;
 if m='utility' and j->>'mime' not in ('image/jpeg','image/png','image/webp') then
  perform public.finish_lockd_document_job((j->>'document_id')::uuid,(j->>'lease_token')::uuid,null,'unsafe_file');return null;
 end if;
 return j||jsonb_build_object('method',m);
end $$;
revoke all on function public.claim_lockd_document_job() from public,anon,authenticated;
grant execute on function public.claim_lockd_document_job() to service_role;
commit;
