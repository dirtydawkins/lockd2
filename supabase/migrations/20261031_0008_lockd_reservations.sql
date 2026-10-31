-- Forward-only, additive reservation foundation. Existing booking rows are preserved.
-- Keep disabled until staging tests and merchant onboarding are complete.
begin;
create table public.lockd_booking_settings (
  singleton boolean primary key default true check(singleton),
  requests_enabled boolean not null default false,
  payment_hold_minutes integer not null default 15 check(payment_hold_minutes between 5 and 60),
  approval_hold_hours integer not null default 24 check(approval_hold_hours between 1 and 72)
);
insert into public.lockd_booking_settings(singleton) values(true);
alter table public.lockd_booking_settings enable row level security;
revoke all on public.lockd_booking_settings from public, anon, authenticated;

alter table public.lockd_bookings drop constraint lockd_bookings_status_check;
alter table public.lockd_bookings add constraint lockd_bookings_status_check check(status in
 ('pending','pending_owner','awaiting_payment','confirmed','active','completed','cancelled','expired','rejected','disputed'));
alter table public.lockd_bookings
 add column owner_id uuid references auth.users(id) on delete set null,
 add column idempotency_key uuid,
 add column currency text check(currency ~ '^[A-Z]{3}$'),
 add column rental_amount numeric(14,2) check(rental_amount >= 0),
 add column deposit_amount numeric(14,2) check(deposit_amount >= 0),
 add column total_amount numeric(14,2) check(total_amount >= 0),
 add column payment_status text not null default 'unpaid' check(payment_status in ('unpaid','processing','paid','refunding','refunded','failed')),
 add column listing_snapshot jsonb,
 add column expires_at timestamptz,
 add column updated_at timestamptz not null default now();
create unique index lockd_booking_idempotency on public.lockd_bookings(customer_id,idempotency_key) where idempotency_key is not null;
create index lockd_booking_customer_history on public.lockd_bookings(customer_id,created_at desc);
create index lockd_booking_owner_history on public.lockd_bookings(owner_id,created_at desc);
create index lockd_booking_live_dates on public.lockd_bookings(listing_id,start_date,end_date)
 where status in ('pending_owner','awaiting_payment','confirmed','active','disputed');

create table public.lockd_booking_events (
 id bigint generated always as identity primary key,
 booking_id uuid not null references public.lockd_bookings(id) on delete restrict,
 actor_id uuid references auth.users(id) on delete set null,
 previous_status text, status text not null, created_at timestamptz not null default now()
);
create index lockd_booking_events_booking on public.lockd_booking_events(booking_id,created_at);
alter table public.lockd_booking_events enable row level security;
revoke all on public.lockd_bookings, public.lockd_booking_events from public,anon,authenticated;

create function public.lockd_record_booking_event() returns trigger language plpgsql security definer
set search_path = public,pg_temp as $$
begin
 if tg_op='INSERT' then
   insert into public.lockd_booking_events(booking_id,actor_id,status) values(new.id,auth.uid(),new.status);
 elsif new.status is distinct from old.status then
   insert into public.lockd_booking_events(booking_id,actor_id,previous_status,status)
   values(new.id,case when new.status='expired' then null else auth.uid() end,old.status,new.status);
 end if;
 return new;
end $$;
create trigger lockd_booking_event after insert or update of status on public.lockd_bookings
for each row execute function public.lockd_record_booking_event();
revoke all on function public.lockd_record_booking_event() from public,anon,authenticated;

-- All capacity writers lock the listing row first. Existing owner upserts also lock it.
create or replace function public.check_lockd_listing_availability(p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.lockd_listings%rowtype; d date; capacity integer; used bigint;
begin
 if p_start_date is null or p_end_date is null or p_quantity is null or p_quantity not between 1 and 20
 or p_start_date < current_date or p_end_date <= p_start_date or p_end_date-p_start_date > 366 then return false; end if;
 select * into l from public.lockd_listings where id=p_listing_id and listing_status='published' and approval_status='approved';
 if not found or p_end_date-p_start_date < l.min_rental_days or (l.max_rental_days is not null and p_end_date-p_start_date > l.max_rental_days) then return false; end if;
 for d in select p_start_date+i from generate_series(0,p_end_date-p_start_date-1) i loop
   select available_units into capacity from public.lockd_listing_availability where listing_id=p_listing_id and calendar_date=d;
   if not found then return false; end if;
   select coalesce(sum(quantity),0) into used from public.lockd_bookings where listing_id=p_listing_id and start_date<=d and end_date>d
   and (status in ('confirmed','active','disputed') or (status in ('pending_owner','awaiting_payment') and expires_at>now()));
   if capacity-used < p_quantity then return false; end if;
 end loop;
 return true;
end $$;

create function public.quote_lockd_booking(p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.lockd_listings%rowtype; days integer; periods integer; rental numeric(14,2); deposit numeric(14,2);
begin
 if not coalesce((select requests_enabled from public.lockd_booking_settings where singleton),false) then raise exception 'Reservations are not enabled yet.'; end if;
 if not public.check_lockd_listing_availability(p_listing_id,p_start_date,p_end_date,p_quantity) then raise exception 'These dates are unavailable.'; end if;
 select * into l from public.lockd_listings where id=p_listing_id;
 if l.owner_id is null or l.price_amount is null or l.currency <> 'KES' or l.price_unit is null then raise exception 'This listing cannot be reserved online.'; end if;
 days:=p_end_date-p_start_date;
 if l.price_unit in ('day','night') then periods:=days;
 elsif l.price_unit='week' and days%7=0 then periods:=days/7;
 elsif l.price_unit='month' and days%30=0 then periods:=days/30;
 elsif l.price_unit='trip' then periods:=1;
 else raise exception 'This billing period needs owner confirmation.'; end if;
 if l.category='stay' and (coalesce(l.attributes->>'price_basis','') not in ('per_room_per_night','per_property_per_night')
   or (l.attributes->>'price_basis'='per_property_per_night' and p_quantity<>1)) then raise exception 'This stay needs owner confirmation.'; end if;
 rental:=l.price_amount*periods*p_quantity;
 deposit:=coalesce(l.deposit_amount,0)*p_quantity;
 if deposit>0 and l.deposit_currency is distinct from l.currency then raise exception 'This listing needs owner confirmation.'; end if;
 return jsonb_build_object('currency',l.currency,'rate',l.price_amount,'billingUnit',l.price_unit,'periods',periods,'quantity',p_quantity,
 'rentalAmount',rental,'depositAmount',deposit,'totalAmount',rental+deposit,'requiresApproval',l.requires_approval,
 'paymentAvailable',false,'startDate',p_start_date,'endDate',p_end_date);
end $$;

create function public.request_lockd_booking(p_listing_id uuid,p_start_date date,p_end_date date,p_quantity integer,p_idempotency_key uuid,p_expected_total numeric,p_expected_currency text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.lockd_listings%rowtype; b public.lockd_bookings%rowtype; q jsonb; settings public.lockd_booking_settings%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Sign in with a verified account.'; end if;
 if p_idempotency_key is null then raise exception 'A request reference is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into b from public.lockd_bookings where customer_id=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
   if (b.listing_id,b.start_date,b.end_date,b.quantity) is distinct from (p_listing_id,p_start_date,p_end_date,p_quantity) then raise exception 'This request reference was already used.'; end if;
   return to_jsonb(b);
 end if;
 if (select count(*) from public.lockd_bookings where customer_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Please wait before sending another request.'; end if;
 select * into l from public.lockd_listings where id=p_listing_id for update;
 if not found or l.owner_id=auth.uid() then raise exception 'This listing cannot be reserved by this account.'; end if;
 update public.lockd_bookings set status='expired',updated_at=now() where listing_id=p_listing_id and status in ('pending_owner','awaiting_payment') and expires_at<=now();
 q:=public.quote_lockd_booking(p_listing_id,p_start_date,p_end_date,p_quantity);
 if p_expected_total is distinct from (q->>'totalAmount')::numeric or p_expected_currency is distinct from q->>'currency' then raise exception 'The price changed. Review the current total.'; end if;
 select * into settings from public.lockd_booking_settings where singleton;
 insert into public.lockd_bookings(listing_id,customer_id,owner_id,start_date,end_date,quantity,status,idempotency_key,currency,rental_amount,deposit_amount,total_amount,listing_snapshot,expires_at)
 values(l.id,auth.uid(),l.owner_id,p_start_date,p_end_date,p_quantity,case when l.requires_approval then 'pending_owner' else 'awaiting_payment' end,
 p_idempotency_key,q->>'currency',(q->>'rentalAmount')::numeric,(q->>'depositAmount')::numeric,(q->>'totalAmount')::numeric,
 jsonb_build_object('title',l.title,'slug',l.slug,'category',l.category,'location',l.location_label,'rate',l.price_amount,'billingUnit',l.price_unit),
 now()+case when l.requires_approval then make_interval(hours=>settings.approval_hold_hours) else make_interval(mins=>settings.payment_hold_minutes) end) returning * into b;
 return to_jsonb(b);
end $$;

create function public.my_lockd_bookings(p_owner boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view reservations.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('status',case when status in ('pending_owner','awaiting_payment') and expires_at<=now() then 'expired' else status end) order by created_at desc)
 from (select * from public.lockd_bookings where case when p_owner then owner_id=auth.uid() else customer_id=auth.uid() end order by created_at desc limit 100) b),'[]'::jsonb);
end $$;

create function public.transition_lockd_booking(p_booking_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; target text; lid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to manage reservations.'; end if;
 select listing_id into lid from public.lockd_bookings where id=p_booking_id and (customer_id=auth.uid() or owner_id=auth.uid());
 if not found then raise exception 'Reservation not found.'; end if;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 if b.status in ('pending_owner','awaiting_payment') and b.expires_at<=now() then
   update public.lockd_bookings set status='expired',updated_at=now() where id=b.id returning * into b;
   return to_jsonb(b);
 end if;
 if p_action='cancel' and auth.uid() in (b.customer_id,b.owner_id) and b.status in ('pending_owner','awaiting_payment') and b.payment_status='unpaid' then target:='cancelled';
 elsif p_action='reject' and auth.uid()=b.owner_id and b.status='pending_owner' then target:='rejected';
 elsif p_action='accept' and auth.uid()=b.owner_id and b.status='pending_owner' then
   if not exists(select 1 from public.lockd_listings where id=lid and listing_status='published' and approval_status='approved') then raise exception 'This listing is no longer published.'; end if;
   target:='awaiting_payment';
 elsif p_action='check_out' and auth.uid()=b.owner_id and b.status='confirmed' and b.payment_status='paid' and current_date>=b.start_date then target:='active';
 elsif p_action='check_in' and auth.uid()=b.owner_id and b.status='active' then target:='completed';
 elsif p_action='dispute' and b.status in ('confirmed','active','completed') then target:='disputed';
 else raise exception 'This reservation change is not permitted.'; end if;
 update public.lockd_bookings set status=target,updated_at=now(),expires_at=case when target='awaiting_payment' then now()+make_interval(mins=>(select payment_hold_minutes from public.lockd_booking_settings where singleton)) else expires_at end where id=b.id returning * into b;
 return to_jsonb(b);
end $$;

revoke all on function public.quote_lockd_booking(uuid,date,date,integer),public.request_lockd_booking(uuid,date,date,integer,uuid,numeric,text),public.my_lockd_bookings(boolean),public.transition_lockd_booking(uuid,text) from public,anon,authenticated;
grant execute on function public.quote_lockd_booking(uuid,date,date,integer) to anon,authenticated;
grant execute on function public.request_lockd_booking(uuid,date,date,integer,uuid,numeric,text),public.my_lockd_bookings(boolean),public.transition_lockd_booking(uuid,text) to authenticated;
create function public.lockd_guard_reserved_capacity() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare reserved bigint;
begin
 perform 1 from public.lockd_listings where id=old.listing_id for update;
 select coalesce(sum(quantity),0) into reserved from public.lockd_bookings where listing_id=old.listing_id and start_date<=old.calendar_date and end_date>old.calendar_date
 and (status in ('confirmed','active','disputed') or (status in ('pending_owner','awaiting_payment') and expires_at>now()));
 if reserved>0 and (tg_op='DELETE' or new.listing_id<>old.listing_id or new.calendar_date<>old.calendar_date or new.available_units<reserved) then raise exception 'Availability is reserved. Resolve existing reservations before changing this calendar.'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.lockd_guard_reserved_capacity() from public,anon,authenticated;
create trigger lockd_reserved_capacity before delete or update on public.lockd_listing_availability for each row execute function public.lockd_guard_reserved_capacity();
-- Clients cannot set prices, payment state, identities, or write the event journal.
commit;
