-- Reuse reservations and their row locks. Provider results are service-only.
-- Test payments can never mark a reservation paid or confirmed.
begin;
create table public.lockd_checkout_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 environment text not null default 'test' check(environment in ('test','live'))
);
insert into public.lockd_checkout_settings(singleton) values(true);
create table public.lockd_checkout_attempts (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.lockd_bookings(id) on delete restrict,
 customer_id uuid not null references auth.users(id) on delete restrict,
 request_key uuid not null,
 environment text not null check(environment in ('test','live')),
 reference text not null unique check(reference ~ '^lockd_pay_(test|live)_[a-f0-9]{32}$'),
 amount_minor bigint not null check(amount_minor>0),
 rental_minor bigint not null check(rental_minor>=0),
 deposit_minor bigint not null check(deposit_minor>=0),
 currency text not null check(currency='KES'),
 state text not null default 'initializing' check(state in ('initializing','pending','verified','failed','review_required','reversed')),
 authorization_url text check(authorization_url ~ '^https://checkout[.]paystack[.]com/[A-Za-z0-9_-]+$'),
 provider_id text unique check(provider_id ~ '^[1-9][0-9]{0,18}$'),
 provider_status text,
 expires_at timestamptz not null,
 needs_recheck boolean not null default false,
 next_check_at timestamptz not null default now(),
 checks integer not null default 0 check(checks between 0 and 100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(customer_id,request_key),
 check(amount_minor=rental_minor+deposit_minor)
);
create unique index lockd_checkout_one_open on public.lockd_checkout_attempts(booking_id)
 where state in ('initializing','pending');
create index lockd_checkout_due on public.lockd_checkout_attempts(next_check_at)
 where state in ('initializing','pending');
create table public.lockd_checkout_journal (
 id bigint generated always as identity primary key,
 attempt_id uuid not null references public.lockd_checkout_attempts(id) on delete restrict,
 provider_id text not null, provider_status text not null,
 amount_minor bigint not null, currency text not null,
 environment text not null check(environment in ('test','live')),
 outcome text not null, created_at timestamptz not null default now(),
 unique(attempt_id,provider_id,provider_status)
);
create trigger lockd_checkout_journal_immutable before update or delete on public.lockd_checkout_journal
for each row execute function public.lockd_immutable_trust_record();
alter table public.lockd_checkout_settings enable row level security;
alter table public.lockd_checkout_attempts enable row level security;
alter table public.lockd_checkout_journal enable row level security;
revoke all on public.lockd_checkout_settings,public.lockd_checkout_attempts,public.lockd_checkout_journal from public,anon,authenticated;

create function public.my_lockd_checkout(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; a public.lockd_checkout_attempts%rowtype; enabled boolean;
begin
 select * into b from public.lockd_bookings where id=p_booking_id and customer_id=auth.uid();
 if not found then raise exception 'Reservation not found.';end if;
 select * into a from public.lockd_checkout_attempts where booking_id=b.id order by created_at desc limit 1;
 select s.enabled and s.environment='live' into enabled from public.lockd_checkout_settings s where singleton;
 return jsonb_build_object('booking',jsonb_build_object('id',b.id,'listingId',b.listing_id,
 'title',b.listing_snapshot->>'title','listingSlug',(select slug from public.lockd_listings where id=b.listing_id and listing_status='published' and approval_status='approved'),'startDate',b.start_date,'endDate',b.end_date,'quantity',b.quantity,
 'currency',b.currency,'rentalAmount',b.rental_amount,'depositAmount',b.deposit_amount,'totalAmount',b.total_amount,
 'status',case when b.status in ('pending_owner','awaiting_payment') and b.expires_at<=now() then 'expired' else b.status end,
 'paymentStatus',b.payment_status,'expiresAt',b.expires_at,'conditions',b.booking_conditions),
 'canPay',coalesce(enabled,false) and b.status='awaiting_payment' and b.expires_at>now() and b.payment_status='unpaid' and public.lockd_trust_ready(b),
 'attempt',case when a.id is null then null else jsonb_build_object('state',a.state,'environment',a.environment,'reference',a.reference,'updatedAt',a.updated_at) end);
end $$;

create function public.begin_lockd_checkout(p_booking_id uuid,p_customer_id uuid,p_key uuid,p_environment text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; a public.lockd_checkout_attempts%rowtype; lid uuid;
begin
 if not exists(select 1 from public.lockd_checkout_settings where singleton and enabled and environment=p_environment) then raise exception 'Checkout is unavailable.';end if;
 if p_key is null or p_customer_id is null then raise exception 'Invalid request.';end if;
 if p_environment='test' and not exists(select 1 from public.lockd_test_payment_members where user_id=p_customer_id and expires_at>now()) then raise exception 'Checkout is unavailable.';end if;
 select listing_id into lid from public.lockd_bookings where id=p_booking_id and customer_id=p_customer_id;
 if not found then raise exception 'Reservation not found.';end if;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 select * into a from public.lockd_checkout_attempts where customer_id=p_customer_id and request_key=p_key;
 if found and a.booking_id<>b.id then raise exception 'Request reference already used.';end if;
 if b.status<>'awaiting_payment' or b.payment_status<>'unpaid' or b.expires_at is null or b.expires_at<=now()
 or b.rental_amount is null or b.deposit_amount is null or b.currency is distinct from 'KES' or b.total_amount is null or b.total_amount<=0
 or b.total_amount<>b.rental_amount+b.deposit_amount or not public.lockd_trust_ready(b)
 or not exists(select 1 from public.lockd_listings where id=lid and listing_status='published' and approval_status='approved') then raise exception 'Reservation is unavailable.';end if;
 if a.id is null then
  select * into a from public.lockd_checkout_attempts where booking_id=b.id and state in ('initializing','pending','verified','review_required') order by created_at desc limit 1;
 end if;
 if a.id is not null then
  return jsonb_build_object('reference',a.reference,'state',a.state,'url',a.authorization_url,'initialize',false);
 end if;
 if (select count(*) from public.lockd_checkout_attempts where customer_id=p_customer_id and created_at>now()-interval '1 hour')>=10 then raise exception 'Please wait before trying again.';end if;
 insert into public.lockd_checkout_attempts(booking_id,customer_id,request_key,environment,reference,amount_minor,rental_minor,deposit_minor,currency,expires_at)
 values(b.id,b.customer_id,p_key,p_environment,'lockd_pay_'||p_environment||'_'||replace(gen_random_uuid()::text,'-',''),
 (b.total_amount*100)::bigint,(b.rental_amount*100)::bigint,(b.deposit_amount*100)::bigint,b.currency,b.expires_at) returning * into a;
 return jsonb_build_object('reference',a.reference,'state',a.state,'initialize',true,'amountMinor',a.amount_minor,'currency',a.currency);
end $$;

create function public.save_lockd_checkout_url(p_reference text,p_url text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_url is null or p_url !~ '^https://checkout[.]paystack[.]com/[A-Za-z0-9_-]+$' then raise exception 'Invalid checkout.';end if;
 update public.lockd_checkout_attempts set authorization_url=p_url,state='pending',updated_at=now(),next_check_at=now()+interval '15 seconds'
 where reference=p_reference and state='initializing';
end $$;

create function public.claim_lockd_checkout_check(p_reference text default null,p_customer_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.lockd_checkout_attempts%rowtype;
begin
 select * into a from public.lockd_checkout_attempts where
 (p_reference is null or reference=p_reference) and (p_customer_id is null or customer_id=p_customer_id)
 and (state in ('initializing','pending') or needs_recheck) and checks<100 and next_check_at<=now()
 order by next_check_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.lockd_checkout_attempts set checks=checks+1,next_check_at=now()+make_interval(secs=>least(900,15*(checks+1))) where id=a.id;
 return jsonb_build_object('reference',a.reference,'environment',a.environment);
end $$;

create function public.wake_lockd_checkout_check(p_reference text) returns void
language sql security definer set search_path=public,pg_temp as $$
 update public.lockd_checkout_attempts set next_check_at=now(),needs_recheck=true,checks=least(checks,99) where reference=p_reference;
$$;

create function public.finish_lockd_checkout(p_reference text,p_provider_id text,p_amount_minor bigint,p_currency text,p_environment text,p_status text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.lockd_checkout_attempts%rowtype; b public.lockd_bookings%rowtype; lid uuid; bid uuid; outcome text; capacity_ok boolean;
begin
 select booking_id into bid from public.lockd_checkout_attempts where reference=p_reference;
 if not found then raise exception 'Payment not found.';end if;
 select listing_id into lid from public.lockd_bookings where id=bid;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=bid for update;
 select * into a from public.lockd_checkout_attempts where reference=p_reference for update;
 if p_provider_id is null or p_provider_id !~ '^[1-9][0-9]{0,18}$' or p_status is null or p_status not in ('abandoned','failed','ongoing','pending','processing','queued','reversed','success') then raise exception 'Invalid payment response.';end if;
 update public.lockd_checkout_attempts set needs_recheck=false where id=a.id;
 if exists(select 1 from public.lockd_checkout_journal where attempt_id=a.id and provider_id=p_provider_id and provider_status=p_status) then return jsonb_build_object('state',a.state);end if;
 if p_amount_minor is distinct from a.amount_minor or p_currency is distinct from a.currency or p_environment is distinct from a.environment
 or (a.provider_id is not null and a.provider_id<>p_provider_id)
 or exists(select 1 from public.lockd_checkout_attempts where provider_id=p_provider_id and id<>a.id) then outcome:='review_required';
 elsif p_status='success' then
  outcome:='verified';
  if a.environment='live' then
   -- Exclude this booking's own hold. The listing lock serializes every capacity writer.
   select not exists(select 1 from generate_series(b.start_date::timestamp,b.end_date::timestamp-interval '1 day',interval '1 day') d
    left join public.lockd_listing_availability av on av.listing_id=lid and av.calendar_date=d::date
    where av.available_units is null or av.available_units-b.quantity < coalesce((select sum(x.quantity) from public.lockd_bookings x
    where x.listing_id=lid and x.id<>b.id and x.start_date<=d::date and x.end_date>d::date
    and (x.status in ('confirmed','active','disputed') or (x.status in ('pending_owner','awaiting_payment') and x.expires_at>now()))),0)) into capacity_ok;
   if exists(select 1 from public.lockd_checkout_attempts where booking_id=b.id and id<>a.id and state in ('initializing','pending','verified','review_required')) then
    update public.lockd_checkout_attempts set state='review_required',updated_at=now() where booking_id=b.id and id<>a.id and state in ('initializing','pending');
    outcome:='review_required';
   end if;
   if outcome='review_required' or b.start_date<current_date or b.status<>'awaiting_payment' or b.payment_status<>'unpaid' or b.expires_at is null or b.expires_at<=now()
   or not capacity_ok or not public.lockd_trust_ready(b)
   or not exists(select 1 from public.lockd_listings where id=lid and listing_status='published' and approval_status='approved') then outcome:='review_required';
   else update public.lockd_bookings set status='confirmed',payment_status='paid',expires_at=null,updated_at=now() where id=b.id;end if;
  end if;
 elsif p_status='reversed' then outcome:='reversed';
 elsif p_status in ('failed','abandoned') then outcome:=case when a.state in ('verified','review_required','reversed') then a.state else 'failed' end;
 else outcome:=case when a.state in ('verified','failed','review_required','reversed') then a.state else 'pending' end;end if;
 -- A reversal is never silently labelled a refund or used to reopen capacity.
 if outcome='reversed' and a.environment='live' and b.payment_status='paid' then
  update public.lockd_bookings set status='disputed',updated_at=now() where id=b.id;
 end if;
 update public.lockd_checkout_attempts set state=outcome,provider_status=p_status,
 provider_id=case when outcome='review_required' then provider_id else p_provider_id end,updated_at=now() where id=a.id;
 insert into public.lockd_checkout_journal(attempt_id,provider_id,provider_status,amount_minor,currency,environment,outcome)
 values(a.id,p_provider_id,p_status,p_amount_minor,p_currency,p_environment,outcome);
 return jsonb_build_object('state',outcome,'environment',a.environment);
end $$;

revoke all on function public.my_lockd_checkout(uuid),public.begin_lockd_checkout(uuid,uuid,uuid,text),public.save_lockd_checkout_url(text,text),public.claim_lockd_checkout_check(text,uuid),public.wake_lockd_checkout_check(text),public.finish_lockd_checkout(text,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.my_lockd_checkout(uuid) to authenticated;
grant execute on function public.begin_lockd_checkout(uuid,uuid,uuid,text),public.save_lockd_checkout_url(text,text),public.claim_lockd_checkout_check(text,uuid),public.wake_lockd_checkout_check(text),public.finish_lockd_checkout(text,text,bigint,text,text,text) to service_role;
commit;
