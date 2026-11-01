-- Activate the existing account-bound ciphertext transport after source review.
-- This records an internal implementation review, NOT an independent crypto audit.
-- No plaintext messages, second login, provider identity assertion or payment change.
begin;
-- Text messaging can launch independently of the attachment-retention worker.
alter table public.lockd_messaging_settings add column attachments_enabled boolean not null default false;
create or replace function public.lockd_messaging_capabilities() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('enabled',enabled and security_reviewed_at is not null and retention_policy_version is not null,
 'attachmentsEnabled',attachments_enabled,'protocol','openpgp-rfc9580-v1','deviceModel','single_device','forwardSecrecy',false,
 'investigatorKey',investigator_key,'investigatorFingerprint',investigator_fingerprint) from public.lockd_messaging_settings where singleton
$$;
alter function public.reserve_lockd_chat_attachment(uuid,uuid,integer) rename to lockd_reserve_chat_attachment_base;
revoke all on function public.lockd_reserve_chat_attachment_base(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function public.reserve_lockd_chat_attachment(p_conversation_id uuid,p_id uuid,p_bytes integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.lockd_messaging_settings where singleton and attachments_enabled) then raise exception 'Attachments are unavailable right now.';end if;
 return public.lockd_reserve_chat_attachment_base(p_conversation_id,p_id,p_bytes);
end $$;
revoke all on function public.reserve_lockd_chat_attachment(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_lockd_chat_attachment(uuid,uuid,integer) to authenticated;
create index lockd_messages_retention on public.lockd_encrypted_messages(created_at);
create function public.lockd_expire_message_content() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[];n integer;
begin
 select array_agg(id) into ids from (select m.id from public.lockd_encrypted_messages m where m.created_at<now()-interval '90 days'
 and not exists(select 1 from public.lockd_chat_attachments a where a.message_id=m.id) order by m.created_at for update skip locked limit 1000)x;
 if ids is null then return 0;end if;
 delete from public.lockd_message_receipts where message_id=any(ids);
 delete from public.lockd_encrypted_messages where id=any(ids);get diagnostics n=row_count;
 return n;
end $$;
revoke all on function public.lockd_expire_message_content() from public,anon,authenticated;
grant execute on function public.lockd_expire_message_content() to service_role;
-- Also enforce expiry when reading; retention never depends on the browser's clock.
alter function public.lockd_message_history(uuid,bigint,bigint) rename to lockd_message_history_before_expiry;
revoke all on function public.lockd_message_history_before_expiry(uuid,bigint,bigint) from public,anon,authenticated,service_role;
create function public.lockd_message_history(p_conversation_id uuid,p_before bigint default null,p_after bigint default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.lockd_conversation_member(p_conversation_id) then raise exception 'Conversation is unavailable.';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.sequence) from (
 select m.*,r.delivered_at,r.read_at from public.lockd_encrypted_messages m left join public.lockd_message_receipts r on r.message_id=m.id
 where m.conversation_id=p_conversation_id and m.created_at>now()-interval '90 days' and (p_before is null or m.sequence<p_before) and (p_after is null or m.sequence>p_after)
 order by case when p_after is not null then m.sequence end asc,m.sequence desc limit 40)x),'[]');
end $$;
revoke all on function public.lockd_message_history(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.lockd_message_history(uuid,bigint,bigint) to authenticated;
drop policy lockd_messages_member_read on public.lockd_encrypted_messages;
create policy lockd_messages_member_read on public.lockd_encrypted_messages for select to authenticated using(created_at>now()-interval '90 days' and public.lockd_conversation_member(conversation_id));
-- Native database maintenance, no new account, network secret or paid service.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('lockd-message-content-retention','17 * * * *','select public.lockd_expire_message_content();');

alter table public.lockd_message_reports alter column encrypted_evidence drop not null;
alter table public.lockd_message_reports alter column investigator_fingerprint drop not null;
alter table public.lockd_message_reports alter column evidence_sha256 drop not null;
alter table public.lockd_message_reports add constraint lockd_report_evidence_bundle check (
 (encrypted_evidence is null and investigator_fingerprint is null and evidence_sha256 is null)
 or (encrypted_evidence is not null and investigator_fingerprint is not null and evidence_sha256 is not null));

create function public.report_lockd_conversation(p_conversation_id uuid,p_client_id uuid,p_category text,p_ids uuid[],p_device uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_message_reports%rowtype;
begin
 perform public.lockd_messaging_ready();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,13));
 if not public.lockd_conversation_member(p_conversation_id) or p_client_id is null
 or p_category is null or p_category not in ('fraud','off_platform_payment','harassment','threats','attachment','listing','unsafe','other') then raise exception 'Conversation is unavailable.'; end if;
 if not exists(select 1 from public.lockd_messaging_devices where id=p_device and user_id=auth.uid() and revoked_at is null) then raise exception 'Verify the current messaging devices.'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 30 or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.lockd_encrypted_messages where id=x and conversation_id=p_conversation_id)) then raise exception 'Choose messages from this conversation.'; end if;
 select * into r from public.lockd_message_reports where reporter_id=auth.uid() and client_id=p_client_id;
 if found then
  if r.conversation_id is distinct from p_conversation_id or r.category is distinct from p_category or r.selected_message_ids is distinct from p_ids then raise exception 'Report retry differs from the original.'; end if;
  return r.id;
 end if;
 if (select count(*) from public.lockd_message_reports where reporter_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'Report limit reached.'; end if;
 insert into public.lockd_message_reports(reporter_id,conversation_id,client_id,reporter_device,category,selected_message_ids)
 values(auth.uid(),p_conversation_id,p_client_id,p_device,p_category,p_ids) returning * into r;
 insert into public.lockd_message_report_audit(report_id,actor_id,event) values(r.id,auth.uid(),'concern_submitted_without_message_content');
 return r.id;
end $$;
revoke all on function public.report_lockd_conversation(uuid,uuid,text,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.report_lockd_conversation(uuid,uuid,text,uuid[],uuid) to authenticated;

-- Keep the established release gate. Record exactly what was reviewed in audit metadata.
update public.lockd_messaging_settings set enabled=true,security_reviewed_at=now(),retention_policy_version='private-messaging-1'
where singleton and security_reviewed_at is null;
insert into public.lockd_trust_audit(event_type,details) values('messaging_internal_release_review',
 jsonb_build_object('protocol','openpgp-rfc9580-v1','scope','participant RPC authorization, ciphertext storage, automatic local keys, key-change pinning, request limits, block and report paths',
 'independent_crypto_audit',false,'forward_secrecy',false,'business_record_tests','awaiting genuine two-party conversation'));

-- KRA is excluded from active intake, while historical records remain intact.
alter function public.create_lockd_address_case(text,text,text,text,uuid) rename to lockd_create_address_case_legacy;
revoke all on function public.lockd_create_address_case_legacy(text,text,text,text,uuid) from public,anon,authenticated,service_role;
create function public.create_lockd_address_case(p_method text,p_address text,p_explanation text,p_consent text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_method='kra_certificate' then raise exception 'This evidence method is not supported.'; end if;
 return public.lockd_create_address_case_legacy(p_method,p_address,p_explanation,p_consent,p_request_key);
end $$;
revoke all on function public.create_lockd_address_case(text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_lockd_address_case(text,text,text,text,uuid) to authenticated;
commit;
