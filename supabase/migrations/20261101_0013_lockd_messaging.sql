-- Two-party, single-device OpenPGP ciphertext transport. Release disabled pending design review.
begin;
create table public.lockd_messaging_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 investigator_key text, investigator_fingerprint text,
 security_reviewed_at timestamptz, retention_policy_version text
);
insert into public.lockd_messaging_settings(singleton) values(true);
create table public.lockd_messaging_devices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 public_key text not null check(length(public_key) between 100 and 20000 and public_key like '-----BEGIN PGP PUBLIC KEY BLOCK-----%'),
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(user_id,fingerprint),unique(fingerprint)
);
create unique index lockd_single_message_device on public.lockd_messaging_devices(user_id) where revoked_at is null;
create table public.lockd_conversations (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.lockd_listings(id) on delete restrict,
 customer_id uuid not null references auth.users(id), owner_id uuid not null references auth.users(id),
 booking_id uuid references public.lockd_bookings(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(customer_id<>owner_id)
);
create unique index lockd_conversation_context on public.lockd_conversations(listing_id,customer_id,owner_id,coalesce(booking_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index lockd_conversation_customer on public.lockd_conversations(customer_id,updated_at desc);
create index lockd_conversation_owner on public.lockd_conversations(owner_id,updated_at desc);
create table public.lockd_encrypted_messages (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 conversation_id uuid not null references public.lockd_conversations(id), sender_id uuid not null references auth.users(id),
 sender_device uuid not null references public.lockd_messaging_devices(id), recipient_device uuid not null references public.lockd_messaging_devices(id),
 client_id uuid not null, ciphertext text not null check(length(ciphertext) between 100 and 65536 and ciphertext like '-----BEGIN PGP MESSAGE-----%'),
 created_at timestamptz not null default now(), unique(sender_id,client_id)
);
create index lockd_message_history on public.lockd_encrypted_messages(conversation_id,sequence desc);
create index lockd_message_rate on public.lockd_encrypted_messages(sender_id,created_at desc);
create table public.lockd_chat_attachments (
 id uuid primary key, conversation_id uuid not null references public.lockd_conversations(id), sender_id uuid not null references auth.users(id),
 object_path text not null unique, byte_size integer not null check(byte_size between 100 and 2200000),
 message_id uuid references public.lockd_encrypted_messages(id), created_at timestamptz not null default now()
);
create table public.lockd_message_receipts (
 message_id uuid primary key references public.lockd_encrypted_messages(id), recipient_id uuid not null references auth.users(id),
 delivered_at timestamptz not null default now(), read_at timestamptz
);
create table public.lockd_message_blocks (
 user_id uuid not null references auth.users(id), blocked_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), primary key(user_id,blocked_id),check(user_id<>blocked_id)
);
create table public.lockd_message_reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id), conversation_id uuid not null references public.lockd_conversations(id),
 client_id uuid not null, reporter_device uuid not null references public.lockd_messaging_devices(id), category text not null check(category in ('fraud','off_platform_payment','harassment','threats','attachment','listing','unsafe','other')),
 selected_message_ids uuid[] not null check(cardinality(selected_message_ids) between 1 and 30),
 encrypted_evidence text not null check(length(encrypted_evidence) between 100 and 262144 and encrypted_evidence like '-----BEGIN PGP MESSAGE-----%'),
 investigator_fingerprint text not null, evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null default 'submitted' check(status in ('submitted','under_review','additional_information_required','escalated','resolved','dismissed')),
 assigned_reviewer uuid references auth.users(id), resolution_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(reporter_id,client_id)
);
create table public.lockd_message_report_audit (
 id bigint generated always as identity primary key, report_id uuid not null references public.lockd_message_reports(id), actor_id uuid references auth.users(id),
 event text not null, reason text check(length(reason)<=2000), created_at timestamptz not null default now()
);
create trigger lockd_report_audit_immutable before update or delete on public.lockd_message_report_audit for each row execute function public.lockd_immutable_trust_record();
create function public.lockd_conversation_member(p_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.lockd_conversations where id=p_id and auth.uid() in (customer_id,owner_id))
$$;
create function public.lockd_messaging_ready() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 if not exists(select 1 from public.lockd_messaging_settings where singleton and enabled and security_reviewed_at is not null and retention_policy_version is not null) then raise exception 'Messaging is not enabled yet.'; end if;
end $$;
create function public.lockd_messaging_capabilities() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('enabled',enabled and security_reviewed_at is not null and retention_policy_version is not null,
 'protocol','openpgp-rfc9580-v1','deviceModel','single_device','forwardSecrecy',false,
 'investigatorKey',investigator_key,'investigatorFingerprint',investigator_fingerprint) from public.lockd_messaging_settings where singleton
$$;
create function public.register_lockd_message_device(p_key text,p_fingerprint text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_messaging_devices%rowtype;
begin
 perform public.lockd_messaging_ready();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,13));
 select * into d from public.lockd_messaging_devices where user_id=auth.uid() and revoked_at is null;
 if found then
 if d.fingerprint is distinct from p_fingerprint or d.public_key is distinct from p_key then raise exception 'An active messaging device already exists.'; end if;
 return to_jsonb(d); end if;
 insert into public.lockd_messaging_devices(user_id,public_key,fingerprint) values(auth.uid(),p_key,p_fingerprint) returning * into d;
 return to_jsonb(d);
end $$;
create function public.revoke_lockd_message_device(p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 update public.lockd_messaging_devices set revoked_at=now() where id=p_id and user_id=auth.uid() and revoked_at is null;
 if not found then raise exception 'Messaging device not found.'; end if;
end $$;
create function public.open_lockd_conversation(p_listing_id uuid,p_booking_id uuid default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.lockd_listings%rowtype; b public.lockd_bookings%rowtype; customer uuid; owner uuid; result uuid;
begin
 perform public.lockd_messaging_ready();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,13));
 if p_booking_id is not null then
 select * into b from public.lockd_bookings where id=p_booking_id and listing_id=p_listing_id and auth.uid() in (customer_id,owner_id);
 if not found then raise exception 'Reservation not found.'; end if;
 customer:=b.customer_id; owner:=b.owner_id;
 else
 select * into l from public.lockd_listings where id=p_listing_id and listing_status='published' and approval_status='approved';
 if not found or l.owner_id is null or l.owner_id=auth.uid() then raise exception 'Conversation is unavailable.'; end if;
 customer:=auth.uid(); owner:=l.owner_id;
 end if;
 select id into result from public.lockd_conversations where listing_id=p_listing_id and customer_id=customer and owner_id=owner and booking_id is not distinct from p_booking_id;
 if found then return result; end if;
 if exists(select 1 from public.lockd_message_blocks where (user_id=customer and blocked_id=owner) or (user_id=owner and blocked_id=customer)) then raise exception 'Conversation is unavailable.'; end if;
 if (select count(*) from public.lockd_conversations where auth.uid() in (customer_id,owner_id) and created_at>now()-interval '1 day')>=10 then raise exception 'Conversation limit reached.'; end if;
 insert into public.lockd_conversations(listing_id,customer_id,owner_id,booking_id) values(p_listing_id,customer,owner,p_booking_id)
 on conflict do nothing returning id into result;
 if result is null then select id into result from public.lockd_conversations where listing_id=p_listing_id and customer_id=customer and owner_id=owner and booking_id is not distinct from p_booking_id; end if;
 return result;
end $$;
create function public.my_lockd_conversations() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select c.*,l.title,l.slug,l.images->>0 image,
 (select count(*) from public.lockd_encrypted_messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and not exists(select 1 from public.lockd_message_receipts r where r.message_id=m.id and r.read_at is not null)) unread,
 exists(select 1 from public.lockd_message_blocks where user_id=auth.uid() and blocked_id=case when c.customer_id=auth.uid() then c.owner_id else c.customer_id end) blocked
 from public.lockd_conversations c left join public.lockd_listings l on l.id=c.listing_id where auth.uid() in (c.customer_id,c.owner_id) order by c.updated_at desc limit 100)x),'[]');
end $$;
create function public.lockd_conversation_devices(p_conversation_id uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 if p_conversation_id is not null and not public.lockd_conversation_member(p_conversation_id) then raise exception 'Conversation is unavailable.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(d)) from public.lockd_messaging_devices d where d.user_id=auth.uid() or (p_conversation_id is not null and d.user_id in (select customer_id from public.lockd_conversations where id=p_conversation_id union select owner_id from public.lockd_conversations where id=p_conversation_id))),'[]');
end $$;
create function public.lockd_conversation_booking_context(p_conversation_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype;
begin
 if not public.lockd_conversation_member(p_conversation_id) then raise exception 'Conversation is unavailable.'; end if;
 select x.* into b from public.lockd_bookings x join public.lockd_conversations c on c.booking_id=x.id where c.id=p_conversation_id and auth.uid() in (x.customer_id,x.owner_id);
 if not found then return null; end if;
 return jsonb_build_object('bookingId',b.id,'status',case when b.status in ('pending_owner','awaiting_payment') and b.expires_at<=now() then 'expired' else b.status end,'paymentStatus',b.payment_status,'startDate',b.start_date,'endDate',b.end_date,
 'events',coalesce((select jsonb_agg(to_jsonb(e)) from (select status,created_at from public.lockd_booking_events where booking_id=b.id order by created_at desc,id desc limit 20)e),'[]'));
end $$;
create function public.reserve_lockd_chat_attachment(p_conversation_id uuid,p_id uuid,p_bytes integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.lockd_chat_attachments%rowtype; c public.lockd_conversations%rowtype; other_id uuid;
begin
 perform public.lockd_messaging_ready();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,13));
 select * into c from public.lockd_conversations where id=p_conversation_id and auth.uid() in (customer_id,owner_id);
 if not found then raise exception 'Conversation is unavailable.'; end if;
 other_id:=case when c.customer_id=auth.uid() then c.owner_id else c.customer_id end;
 if exists(select 1 from public.lockd_message_blocks where (user_id=auth.uid() and blocked_id=other_id) or (user_id=other_id and blocked_id=auth.uid())) then raise exception 'Conversation is unavailable.'; end if;
 select * into a from public.lockd_chat_attachments where id=p_id and sender_id=auth.uid() and conversation_id=c.id;
 if found then return jsonb_build_object('id',a.id,'path',a.object_path,'bucket','lockd-chat-private'); end if;
 if (select count(*) from public.lockd_chat_attachments where sender_id=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Attachment limit reached.'; end if;
 insert into public.lockd_chat_attachments(id,conversation_id,sender_id,object_path,byte_size) values(p_id,c.id,auth.uid(),c.id::text||'/'||p_id::text,p_bytes) returning * into a;
 return jsonb_build_object('id',a.id,'path',a.object_path,'bucket','lockd-chat-private');
end $$;
create function public.lockd_chat_file_access(p_path text,p_upload boolean) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.lockd_chat_attachments a where object_path=p_path and
 case when p_upload then sender_id=auth.uid() and message_id is null and created_at>now()-interval '15 minutes'
 else message_id is not null and public.lockd_conversation_member(a.conversation_id) end)
$$;
create function public.send_lockd_ciphertext(p_conversation_id uuid,p_client_id uuid,p_sender_device uuid,p_recipient_device uuid,p_ciphertext text,p_attachment_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.lockd_conversations%rowtype; m public.lockd_encrypted_messages%rowtype; other_id uuid;
begin
 perform public.lockd_messaging_ready();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,13));
 select * into c from public.lockd_conversations where id=p_conversation_id and auth.uid() in (customer_id,owner_id) for update;
 if not found then raise exception 'Conversation is unavailable.'; end if;
 select * into m from public.lockd_encrypted_messages where sender_id=auth.uid() and client_id=p_client_id;
 if found then
 if m.conversation_id is distinct from c.id or m.ciphertext is distinct from p_ciphertext or m.sender_device is distinct from p_sender_device or m.recipient_device is distinct from p_recipient_device then raise exception 'Message retry differs from the original.'; end if;
 return to_jsonb(m); end if;
 other_id:=case when c.customer_id=auth.uid() then c.owner_id else c.customer_id end;
 if exists(select 1 from public.lockd_message_blocks where (user_id=auth.uid() and blocked_id=other_id) or (user_id=other_id and blocked_id=auth.uid())) then raise exception 'Conversation is unavailable.'; end if;
 if not exists(select 1 from public.lockd_messaging_devices where id=p_sender_device and user_id=auth.uid() and revoked_at is null)
 or not exists(select 1 from public.lockd_messaging_devices where id=p_recipient_device and user_id=other_id and revoked_at is null) then raise exception 'Verify the current messaging devices.'; end if;
 if (select count(*) from public.lockd_encrypted_messages where sender_id=auth.uid() and created_at>now()-interval '1 minute')>=30 then raise exception 'Please slow down.'; end if;
 if p_attachment_ids is null or cardinality(p_attachment_ids)>3 or exists(select 1 from unnest(p_attachment_ids) aid where not exists(select 1 from public.lockd_chat_attachments a join storage.objects o on o.bucket_id='lockd-chat-private' and o.name=a.object_path where a.id=aid and a.sender_id=auth.uid() and a.conversation_id=c.id and a.message_id is null and coalesce(o.metadata->>'size','0')::bigint=a.byte_size)) then raise exception 'Attachment upload is incomplete.'; end if;
 insert into public.lockd_encrypted_messages(conversation_id,sender_id,sender_device,recipient_device,client_id,ciphertext) values(c.id,auth.uid(),p_sender_device,p_recipient_device,p_client_id,p_ciphertext) returning * into m;
 update public.lockd_chat_attachments set message_id=m.id where id=any(p_attachment_ids);
 update public.lockd_conversations set updated_at=now() where id=c.id;
 return to_jsonb(m);
end $$;
create function public.lockd_message_history(p_conversation_id uuid,p_before bigint default null,p_after bigint default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.lockd_conversation_member(p_conversation_id) then raise exception 'Conversation is unavailable.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.sequence) from (
 select m.*,r.delivered_at,r.read_at from public.lockd_encrypted_messages m left join public.lockd_message_receipts r on r.message_id=m.id
 where m.conversation_id=p_conversation_id and (p_before is null or m.sequence<p_before) and (p_after is null or m.sequence>p_after)
 order by case when p_after is not null then m.sequence end asc,m.sequence desc limit 40)x),'[]');
end $$;
create function public.acknowledge_lockd_message(p_message_id uuid,p_read boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.lockd_encrypted_messages%rowtype;
begin
 select * into m from public.lockd_encrypted_messages where id=p_message_id and sender_id<>auth.uid();
 if not found or not public.lockd_conversation_member(m.conversation_id) then raise exception 'Message is unavailable.'; end if;
 insert into public.lockd_message_receipts(message_id,recipient_id,read_at) values(m.id,auth.uid(),case when p_read then now() else null end)
 on conflict(message_id) do update set read_at=coalesce(lockd_message_receipts.read_at,excluded.read_at);
end $$;
create function public.block_lockd_participant(p_conversation_id uuid,p_block boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare other_id uuid;
begin
 select case when customer_id=auth.uid() then owner_id else customer_id end into other_id from public.lockd_conversations where id=p_conversation_id and auth.uid() in (customer_id,owner_id);
 if not found or p_block is null then raise exception 'Conversation is unavailable.'; end if;
 if p_block then insert into public.lockd_message_blocks(user_id,blocked_id) values(auth.uid(),other_id) on conflict do nothing;
 else delete from public.lockd_message_blocks where user_id=auth.uid() and blocked_id=other_id; end if;
end $$;
create function public.report_lockd_messages(p_conversation_id uuid,p_client_id uuid,p_category text,p_ids uuid[],p_evidence text,p_fingerprint text,p_sha256 text,p_device uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; other_id uuid;
begin
 if not public.lockd_conversation_member(p_conversation_id) then raise exception 'Conversation is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,13));
 select id into result from public.lockd_message_reports where reporter_id=auth.uid() and client_id=p_client_id;
 if found then return result; end if;
 if not exists(select 1 from public.lockd_messaging_settings where singleton and investigator_key is not null and investigator_fingerprint=p_fingerprint) then raise exception 'Secure reporting is not configured.'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 30 or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.lockd_encrypted_messages where id=x and conversation_id=p_conversation_id)) then raise exception 'Choose messages from this conversation.'; end if;
 if p_sha256 is distinct from encode(sha256(convert_to(p_evidence,'UTF8')),'hex') then raise exception 'Evidence digest does not match.'; end if;
 if not exists(select 1 from public.lockd_messaging_devices where id=p_device and user_id=auth.uid() and revoked_at is null) then raise exception 'Verify the current messaging devices.'; end if;
 if (select count(*) from public.lockd_message_reports where reporter_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'Report limit reached.'; end if;
 insert into public.lockd_message_reports(reporter_id,conversation_id,client_id,reporter_device,category,selected_message_ids,encrypted_evidence,investigator_fingerprint,evidence_sha256)
 values(auth.uid(),p_conversation_id,p_client_id,p_device,p_category,p_ids,p_evidence,p_fingerprint,p_sha256) returning id into result;
 insert into public.lockd_message_report_audit(report_id,actor_id,event) values(result,auth.uid(),'submitted');
 return result;
end $$;
create function public.my_lockd_message_reports() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,category,status,created_at,resolution_reason from public.lockd_message_reports where reporter_id=auth.uid() order by created_at desc limit 50)x),'[]');
end $$;
create function public.lockd_message_report_queue() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.lockd_require_trust_admin();
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,category,status,created_at,assigned_reviewer from public.lockd_message_reports order by created_at desc limit 50)x),'[]');
end $$;
create function public.lockd_message_report_evidence(p_report_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_message_reports%rowtype;
begin
 perform public.lockd_require_trust_admin();
 select * into r from public.lockd_message_reports where id=p_report_id;
 if not found then raise exception 'Report is unavailable.'; end if;
 insert into public.lockd_message_report_audit(report_id,actor_id,event) values(r.id,auth.uid(),'evidence_accessed');
 return jsonb_build_object('report',to_jsonb(r),'reporterKey',(select jsonb_build_object('publicKey',public_key,'fingerprint',fingerprint) from public.lockd_messaging_devices where id=r.reporter_device),'audit',coalesce((select jsonb_agg(to_jsonb(x)) from public.lockd_message_report_audit x where report_id=r.id),'[]'));
end $$;
create function public.review_lockd_message_report(p_report_id uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_message_reports%rowtype;
begin
 perform public.lockd_require_trust_admin();
 select * into r from public.lockd_message_reports where id=p_report_id for update;
 if not found then raise exception 'Report is unavailable.'; end if;
 if exists(select 1 from public.lockd_conversations where id=r.conversation_id and auth.uid() in (customer_id,owner_id)) then raise exception 'A different reviewer is required.'; end if;
 if p_status is null or p_status not in ('under_review','additional_information_required','escalated','resolved','dismissed') or length(trim(coalesce(p_reason,''))) not between 10 and 2000 or r.status in ('resolved','dismissed') then raise exception 'A review decision and reason are required.'; end if;
 update public.lockd_message_reports set status=p_status,assigned_reviewer=auth.uid(),resolution_reason=p_reason,updated_at=now() where id=r.id;
 insert into public.lockd_message_report_audit(report_id,actor_id,event,reason) values(r.id,auth.uid(),p_status,p_reason);
 -- Reports alone NEVER restrict an account, change payment or alter a booking.
end $$;

do $$declare t text; f record;begin
 foreach t in array array['lockd_messaging_settings','lockd_messaging_devices','lockd_conversations','lockd_encrypted_messages','lockd_chat_attachments','lockd_message_receipts','lockd_message_blocks','lockd_message_reports','lockd_message_report_audit'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname in ('lockd_chat_file_access','reserve_lockd_chat_attachment','lockd_conversation_member','lockd_messaging_ready','lockd_messaging_capabilities','register_lockd_message_device','revoke_lockd_message_device','open_lockd_conversation','my_lockd_conversations','lockd_conversation_devices','send_lockd_ciphertext','lockd_message_history','acknowledge_lockd_message','block_lockd_participant','report_lockd_messages','my_lockd_message_reports','lockd_message_report_queue','lockd_message_report_evidence','review_lockd_message_report') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.sig::text not like 'lockd_messaging_ready(%' then execute format('grant execute on function %s to authenticated',f.sig); end if;
 end loop;
end $$;
revoke all on function public.lockd_conversation_booking_context(uuid) from public,anon,authenticated;
grant execute on function public.lockd_conversation_booking_context(uuid) to authenticated;
-- Realtime postgresql changes obey participant RLS. No administrative exception for ordinary chat.
grant select on public.lockd_encrypted_messages,public.lockd_message_receipts to authenticated;
create policy lockd_messages_member_read on public.lockd_encrypted_messages for select to authenticated using(public.lockd_conversation_member(conversation_id));
create policy lockd_receipts_member_read on public.lockd_message_receipts for select to authenticated using(exists(select 1 from public.lockd_encrypted_messages m where m.id=message_id and public.lockd_conversation_member(m.conversation_id)));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lockd-chat-private','lockd-chat-private',false,2200000,array['application/octet-stream']);
create policy lockd_chat_ciphertext_upload on storage.objects for insert to authenticated with check(bucket_id='lockd-chat-private' and public.lockd_chat_file_access(name,true));
create policy lockd_chat_ciphertext_read on storage.objects for select to authenticated using(bucket_id='lockd-chat-private' and public.lockd_chat_file_access(name,false));
-- Explicit publication step is guarded for existing Supabase/PGlite environments.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.lockd_encrypted_messages,public.lockd_message_receipts;
 end if;
end $$;
commit;
