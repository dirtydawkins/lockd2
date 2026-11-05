begin;
-- Private leased worker context; compare only consented evidence from one case.
create function public.lockd_document_comparison_context(p_document_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_verification_documents%rowtype; c public.lockd_verification_cases%rowtype;
begin
 perform 1 from public.lockd_document_jobs where document_id=p_document_id and state='processing' and lease_token=p_lease and lease_until>now();
 if not found then raise exception 'Document lease expired.';end if;
 select * into d from public.lockd_verification_documents where id=p_document_id;
 if d.verification_case_id is null then return '[]'::jsonb;end if;
 select * into c from public.lockd_verification_cases where id=d.verification_case_id;
 if not found or c.withdrawn_at is not null or c.expires_at<=now() or d.retention_expires_at<=now()
 or not exists(select 1 from public.lockd_verification_consents where case_id=c.id and user_id=c.user_id and purpose='processing') then raise exception 'Evidence is unavailable.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('document_id',x.id,'fields',x.fields)) from (
 select o.id,a.result->'fields' fields from public.lockd_verification_documents o join public.lockd_document_analyses a on a.document_id=o.id
 where o.verification_case_id=c.id and o.user_id=c.user_id and o.id<>d.id and o.state='screened' and o.retention_expires_at>now()
 order by o.created_at limit 5)x),'[]'::jsonb);
end $$;
revoke all on function public.lockd_document_comparison_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lockd_document_comparison_context(uuid,uuid) to service_role;
commit;
