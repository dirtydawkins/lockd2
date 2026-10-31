-- Two-party condition acknowledgements, dispute records and in-app notifications.
-- No payment/refund status is changed by these operations.
begin;
create table public.lockd_handover_records (
 booking_id uuid not null references public.lockd_bookings(id) on delete restrict,
 phase text not null check(phase in ('out','return')), version integer not null check(version>0),
 condition_summary text not null check(length(trim(condition_summary)) between 5 and 2000),
 owner_acknowledged_at timestamptz, customer_acknowledged_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(booking_id,phase)
);
create table public.lockd_disputes (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.lockd_bookings(id) on delete restrict,
 opened_by uuid not null references auth.users(id), description text not null check(length(trim(description)) between 10 and 2000),
 previous_booking_status text not null, status text not null default 'open' check(status in ('open','resolved','dismissed')),
 resolution_reason text check(length(trim(resolution_reason)) between 10 and 2000), resolved_by uuid references auth.users(id),
 created_at timestamptz not null default now(), resolved_at timestamptz, appealed_at timestamptz
);
create unique index lockd_one_open_dispute on public.lockd_disputes(booking_id) where status='open';
create table public.lockd_notifications (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete restrict,
 booking_id uuid not null references public.lockd_bookings(id) on delete restrict,
 event_type text not null, message text not null, created_at timestamptz not null default now(), read_at timestamptz
);
create index lockd_notification_inbox on public.lockd_notifications(user_id,created_at desc);
alter table public.lockd_handover_records enable row level security;
alter table public.lockd_disputes enable row level security;
alter table public.lockd_notifications enable row level security;
revoke all on public.lockd_handover_records,public.lockd_disputes,public.lockd_notifications from public,anon,authenticated;

create function public.acknowledge_lockd_handover(p_booking_id uuid,p_phase text,p_summary text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; h public.lockd_handover_records%rowtype; is_owner boolean; lid uuid;
begin
 select listing_id into lid from public.lockd_bookings where id=p_booking_id and auth.uid() in (owner_id,customer_id);
 if not found then raise exception 'Reservation not found.'; end if;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 if p_phase is null or p_phase not in ('out','return') or b.payment_status<>'paid'
 or (p_phase='out' and (b.status<>'confirmed' or current_date<b.start_date or current_date>=b.end_date or not public.lockd_trust_ready(b)))
 or (p_phase='return' and b.status not in ('active','disputed')) then raise exception 'This handover change is not permitted.'; end if;
 if length(trim(coalesce(p_summary,''))) not between 5 and 2000 then raise exception 'A condition summary is required.'; end if;
 is_owner:=auth.uid()=b.owner_id;
 select * into h from public.lockd_handover_records where booking_id=b.id and phase=p_phase for update;
 if not found then
  if not is_owner or p_expected_version is distinct from 0 then raise exception 'This handover change is not permitted.'; end if;
  insert into public.lockd_handover_records(booking_id,phase,version,condition_summary,owner_acknowledged_at)
  values(b.id,p_phase,1,p_summary,now()) returning * into h;
 else
  if h.version is distinct from p_expected_version then raise exception 'This handover change is not permitted.'; end if;
  if h.condition_summary is distinct from p_summary then
   if not is_owner then raise exception 'This handover change is not permitted.'; end if;
   h.version:=h.version+1; h.condition_summary:=p_summary; h.customer_acknowledged_at:=null; h.owner_acknowledged_at:=now();
  elsif is_owner then h.owner_acknowledged_at:=coalesce(h.owner_acknowledged_at,now());
  else h.customer_acknowledged_at:=coalesce(h.customer_acknowledged_at,now()); end if;
  update public.lockd_handover_records set version=h.version,condition_summary=h.condition_summary,
   owner_acknowledged_at=h.owner_acknowledged_at,customer_acknowledged_at=h.customer_acknowledged_at,updated_at=now()
   where booking_id=b.id and phase=p_phase returning * into h;
 end if;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type,details) values(auth.uid(),b.id,'condition_acknowledgement',jsonb_build_object('phase',p_phase,'version',h.version,'actor',case when is_owner then 'owner' else 'customer' end,'conditionSummary',h.condition_summary));
 return to_jsonb(h);
end $$;
create function public.my_lockd_handover(p_booking_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.lockd_bookings where id=p_booking_id and auth.uid() in (customer_id,owner_id)) then raise exception 'Reservation not found.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(h)) from public.lockd_handover_records h where booking_id=p_booking_id),'[]');
end $$;
create function public.lockd_guard_handover_state() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.trust_policy_id is not null and coalesce((new.trust_requirements->>'handover')::boolean,false)=false then return new; end if;
 if new.status='active' and old.status<>'active' and not exists(select 1 from public.lockd_handover_records where booking_id=new.id and phase='out' and owner_acknowledged_at is not null and customer_acknowledged_at is not null) then raise exception 'Record both handover acknowledgements first.'; end if;
 if new.status='completed' and old.status<>'completed' and not exists(select 1 from public.lockd_handover_records where booking_id=new.id and phase='return' and owner_acknowledged_at is not null and customer_acknowledged_at is not null) then raise exception 'Record both return acknowledgements first.'; end if;
 return new;
end $$;
create trigger lockd_handover_state_guard before update of status on public.lockd_bookings for each row execute function public.lockd_guard_handover_state();

create function public.open_lockd_dispute(p_booking_id uuid,p_description text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; d public.lockd_disputes%rowtype; lid uuid;
begin
 if length(trim(coalesce(p_description,''))) not between 10 and 2000 then raise exception 'A dispute description is required.'; end if;
 select listing_id into lid from public.lockd_bookings where id=p_booking_id and auth.uid() in (customer_id,owner_id);
 if not found then raise exception 'Reservation not found.'; end if;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 select * into d from public.lockd_disputes where booking_id=b.id and status='open';
 if found then return to_jsonb(d); end if;
 if b.status not in ('confirmed','active','completed') then raise exception 'This reservation change is not permitted.'; end if;
 insert into public.lockd_disputes(booking_id,opened_by,description,previous_booking_status) values(b.id,auth.uid(),p_description,b.status) returning * into d;
 update public.lockd_bookings set status='disputed',updated_at=now() where id=b.id;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type,details) values(auth.uid(),b.id,'dispute_opened',jsonb_build_object('disputeId',d.id));
 return to_jsonb(d);
end $$;
create function public.my_lockd_disputes() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view disputes.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select d.* from public.lockd_disputes d join public.lockd_bookings b on b.id=d.booking_id
 where auth.uid() in (b.customer_id,b.owner_id) order by d.created_at desc limit 100)x),'[]');
end $$;
create function public.resolve_lockd_dispute(p_dispute_id uuid,p_resolution text,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; d public.lockd_disputes%rowtype; lid uuid; bid uuid;
begin
 perform public.lockd_require_trust_admin();
 if p_resolution is null or p_resolution not in ('resolved','dismissed') or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A resolution and reason are required.'; end if;
 select b0.listing_id,b0.id into lid,bid from public.lockd_disputes d0 join public.lockd_bookings b0 on b0.id=d0.booking_id where d0.id=p_dispute_id;
 if not found then raise exception 'Dispute not found.'; end if;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=bid for update;
 select * into d from public.lockd_disputes where id=p_dispute_id for update;
 if auth.uid() in (b.customer_id,b.owner_id) then raise exception 'A different reviewer is required.'; end if;
 if d.status<>'open' or b.status not in ('disputed','completed') then raise exception 'This reservation change is not permitted.'; end if;
 -- A resolution is a case decision, never proof of a refund, payout, return or payment.
 update public.lockd_disputes set status=p_resolution,resolution_reason=p_reason,resolved_by=auth.uid(),resolved_at=now() where id=d.id returning * into d;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type,details) values(auth.uid(),b.id,'dispute_resolved',jsonb_build_object('disputeId',d.id,'resolution',p_resolution,'reason',p_reason));
 -- Keep disputed booking capacity held until a separate operational resolution is verified.
 insert into public.lockd_notifications(user_id,booking_id,event_type,message)
 select u,b.id,'dispute_resolved','A dispute decision is available. This does not confirm any refund or return.' from unnest(array[b.customer_id,b.owner_id]) u where u is not null;
 return to_jsonb(d);
end $$;

create function public.appeal_lockd_dispute(p_dispute_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.lockd_disputes%rowtype; b public.lockd_bookings%rowtype;
begin
 if length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'An appeal reason is required.'; end if;
 select b0.* into b from public.lockd_bookings b0 join public.lockd_disputes d0 on d0.booking_id=b0.id where d0.id=p_dispute_id and auth.uid() in (b0.customer_id,b0.owner_id);
 if not found then raise exception 'Dispute not found.'; end if;
 perform 1 from public.lockd_listings where id=b.listing_id for update;
 perform 1 from public.lockd_bookings where id=b.id for update;
 select * into d from public.lockd_disputes where id=p_dispute_id for update;
 if d.status='open' or d.appealed_at is not null then raise exception 'This reservation change is not permitted.'; end if;
 update public.lockd_disputes set status='open',appealed_at=now(),resolved_at=null,resolved_by=null,resolution_reason=null where id=d.id returning * into d;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type,details) values(auth.uid(),b.id,'dispute_appealed',jsonb_build_object('disputeId',d.id,'reason',p_reason));
 return to_jsonb(d);
end $$;
create function public.finalize_lockd_disputed_return(p_booking_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; lid uuid;
begin
 perform public.lockd_require_trust_admin();
 if length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'A resolution and reason are required.'; end if;
 select listing_id into lid from public.lockd_bookings where id=p_booking_id;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 if not found then raise exception 'Reservation not found.'; end if;
 if auth.uid() in (b.customer_id,b.owner_id) then raise exception 'A different reviewer is required.'; end if;
 if b.status<>'disputed' or exists(select 1 from public.lockd_disputes where booking_id=b.id and status='open')
 or not exists(select 1 from public.lockd_disputes where booking_id=b.id and status in ('resolved','dismissed'))
 or not exists(select 1 from public.lockd_handover_records where booking_id=b.id and phase='return' and owner_acknowledged_at is not null and customer_acknowledged_at is not null) then raise exception 'This reservation change is not permitted.'; end if;
 update public.lockd_bookings set status='completed',updated_at=now() where id=b.id returning * into b;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type,details) values(auth.uid(),b.id,'disputed_return_finalized',jsonb_build_object('reason',p_reason));
 return to_jsonb(b);
end $$;

create function public.lockd_operations_overview() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.lockd_require_trust_admin();
 return jsonb_build_object('disputes',coalesce((select jsonb_agg(to_jsonb(d)) from (select * from public.lockd_disputes where status='open' order by created_at limit 100)d),'[]'),
 'counts',jsonb_build_object('bookings',(select count(*) from public.lockd_bookings),'awaitingReview',(select count(*) from public.lockd_bookings where status='pending_owner' and expires_at>now()),
 'overdue',(select count(*) from public.lockd_bookings where status in ('active','disputed') and end_date<current_date and not exists(select 1 from public.lockd_handover_records h where h.booking_id=lockd_bookings.id and phase='return' and customer_acknowledged_at is not null and owner_acknowledged_at is not null))));
end $$;

create function public.lockd_notify_booking_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare event text;
begin
 if tg_op='INSERT' then event:='request_recorded';
 elsif new.status is distinct from old.status then event:=new.status;
 elsif (new.owner_approval,new.platform_approval) is distinct from (old.owner_approval,old.platform_approval) then event:='approval_updated';
 else return new; end if;
 insert into public.lockd_notifications(user_id,booking_id,event_type,message)
 select u,new.id,event,case when event='request_recorded' then 'Your rental request has been recorded. It is not a confirmed rental.' else 'Your reservation has an update: '||replace(event,'_',' ')||'.' end
 from unnest(array[new.customer_id,new.owner_id])u where u is not null;
 return new;
end $$;
create trigger lockd_notify_booking after insert or update on public.lockd_bookings for each row execute function public.lockd_notify_booking_change();
create function public.my_lockd_notifications() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view notifications.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(n)) from (select id,booking_id,event_type,message,created_at,read_at from public.lockd_notifications where user_id=auth.uid() order by created_at desc,id desc limit 100)n),'[]');
end $$;
create function public.read_lockd_notification(p_id bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view notifications.'; end if;
 update public.lockd_notifications set read_at=coalesce(read_at,now()) where id=p_id and user_id=auth.uid();
end $$;
revoke all on function public.acknowledge_lockd_handover(uuid,text,text,integer),public.my_lockd_handover(uuid),public.lockd_guard_handover_state(),public.open_lockd_dispute(uuid,text),public.my_lockd_disputes(),public.resolve_lockd_dispute(uuid,text,text),public.lockd_notify_booking_change(),public.my_lockd_notifications(),public.read_lockd_notification(bigint),public.appeal_lockd_dispute(uuid,text),public.finalize_lockd_disputed_return(uuid,text),public.lockd_operations_overview() from public,anon,authenticated;
grant execute on function public.acknowledge_lockd_handover(uuid,text,text,integer),public.my_lockd_handover(uuid),public.open_lockd_dispute(uuid,text),public.my_lockd_disputes(),public.resolve_lockd_dispute(uuid,text,text),public.my_lockd_notifications(),public.read_lockd_notification(bigint),public.appeal_lockd_dispute(uuid,text),public.finalize_lockd_disputed_return(uuid,text),public.lockd_operations_overview() to authenticated;
commit;
