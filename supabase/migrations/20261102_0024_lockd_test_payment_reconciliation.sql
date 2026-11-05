-- Additive sandbox ledger. No production booking, payment or payout updates.
begin;
create table public.lockd_test_payment_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into public.lockd_test_payment_settings(singleton) values(true);
create table public.lockd_test_payment_members (
 user_id uuid primary key references auth.users(id) on delete restrict,
 approved_by uuid not null references auth.users(id) on delete restrict,
 consent_version text not null check(length(trim(consent_version)) between 1 and 80),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table public.lockd_test_payment_intents (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.lockd_bookings(id) on delete restrict,
 customer_id uuid not null references auth.users(id) on delete restrict,
 idempotency_key uuid not null,
 reference text not null unique default ('lockd_test_'||replace(gen_random_uuid()::text,'-','')) check(reference ~ '^lockd_test_[a-f0-9]{32}$'),
 provider text not null default 'paystack' check(provider='paystack'),
 environment text not null default 'test' check(environment='test'),
 rental_minor bigint not null check(rental_minor>=0),
 deposit_minor bigint not null check(deposit_minor>=0),
 amount_minor bigint not null check(amount_minor>0 and amount_minor=rental_minor+deposit_minor),
 currency text not null check(currency='KES'),
 state text not null default 'registered' check(state in ('registered','pending','verified','failed','reversed','review_required')),
 provider_id text unique check(provider_id ~ '^[1-9][0-9]{0,18}$'),
 provider_status text check(provider_status in ('abandoned','failed','ongoing','pending','processing','queued','reversed','success')),
 expires_at timestamptz not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(customer_id,idempotency_key)
);
create index lockd_test_payment_booking on public.lockd_test_payment_intents(booking_id,created_at desc);
create table public.lockd_test_payment_events (
 id uuid primary key default gen_random_uuid(),
 intent_id uuid not null references public.lockd_test_payment_intents(id) on delete restrict,
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','processing','retry','complete','dead_letter')),
 attempts integer not null default 0 check(attempts between 0 and 8),
 available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 last_error text check(last_error in ('provider_unavailable','invalid_response','amount_mismatch','reference_conflict')),
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(intent_id,payload_sha256)
);
create index lockd_test_payment_jobs_due on public.lockd_test_payment_events(state,available_at);
create table public.lockd_test_payment_journal (
 id bigint generated always as identity primary key,
 intent_id uuid not null references public.lockd_test_payment_intents(id) on delete restrict,
 event_id uuid not null references public.lockd_test_payment_events(id) on delete restrict,
 provider_id text not null,
 provider_status text not null,
 amount_minor bigint not null, currency text not null check(currency='KES'),
 environment text not null default 'test' check(environment='test'),
 created_at timestamptz not null default now(),
 unique(intent_id,provider_id,provider_status)
);
create trigger lockd_test_payment_journal_immutable before update or delete on public.lockd_test_payment_journal
for each row execute function public.lockd_immutable_trust_record();

alter table public.lockd_test_payment_settings enable row level security;
alter table public.lockd_test_payment_members enable row level security;
alter table public.lockd_test_payment_intents enable row level security;
alter table public.lockd_test_payment_events enable row level security;
alter table public.lockd_test_payment_journal enable row level security;
revoke all on public.lockd_test_payment_settings,public.lockd_test_payment_members,public.lockd_test_payment_intents,public.lockd_test_payment_events,public.lockd_test_payment_journal from public,anon,authenticated;

-- Only the existing private service can register a reference. Prices come from
-- the existing booking, never the caller. No email or payment instrument stored.
create function public.register_lockd_test_payment(p_booking_id uuid,p_key uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; i public.lockd_test_payment_intents%rowtype;
begin
 if not coalesce((select enabled from public.lockd_test_payment_settings where singleton),false) then raise exception 'Test payment processing is disabled.'; end if;
 if p_key is null then raise exception 'Request reference required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('test-payment:'||p_booking_id::text,0));
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 if not found or b.status<>'awaiting_payment' or b.expires_at<=now() or b.expires_at is null
 or b.payment_status<>'unpaid' or b.currency is distinct from 'KES' or b.total_amount is null or b.total_amount<=0
 or b.rental_amount is null or b.deposit_amount is null or b.total_amount<>b.rental_amount+b.deposit_amount
 or not public.lockd_trust_ready(b)
 or not exists(select 1 from public.lockd_test_payment_members where user_id=b.customer_id and expires_at>now())
 or not exists(select 1 from public.lockd_listings where id=b.listing_id and listing_status='published' and approval_status='approved') then raise exception 'Reservation is unavailable for test payment.'; end if;
 select * into i from public.lockd_test_payment_intents where customer_id=b.customer_id and idempotency_key=p_key;
 if found then
  if i.booking_id<>b.id then raise exception 'Request reference already used.';end if;
  return jsonb_build_object('id',i.id,'reference',i.reference,'state',i.state,'environment','test');
 end if;
 -- Never open parallel charges for a booking after an unknown or successful result.
 if exists(select 1 from public.lockd_test_payment_intents where booking_id=b.id and state not in ('failed')) then raise exception 'Reconcile the existing payment attempt first.';end if;
 insert into public.lockd_test_payment_intents(booking_id,customer_id,idempotency_key,rental_minor,deposit_minor,amount_minor,currency,expires_at)
 values(b.id,b.customer_id,p_key,(b.rental_amount*100)::bigint,(b.deposit_amount*100)::bigint,(b.total_amount*100)::bigint,b.currency,b.expires_at) returning * into i;
 return jsonb_build_object('id',i.id,'reference',i.reference,'state',i.state,'environment','test');
end $$;

create function public.enqueue_lockd_test_payment_event(p_reference text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare i uuid;
begin
 if not coalesce((select enabled from public.lockd_test_payment_settings where singleton),false) then raise exception 'Test payment processing is disabled.';end if;
 if p_reference is null or p_reference !~ '^lockd_test_[a-f0-9]{32}$' or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid event.';end if;
 select id into i from public.lockd_test_payment_intents where reference=p_reference and environment='test';
 if not found then return jsonb_build_object('queued',false);end if;
 insert into public.lockd_test_payment_events(intent_id,payload_sha256) values(i,p_sha256) on conflict(intent_id,payload_sha256) do nothing;
 return jsonb_build_object('queued',true);
end $$;

create function public.claim_lockd_test_payment_event() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.lockd_test_payment_events%rowtype; r text;
begin
 if not coalesce((select enabled from public.lockd_test_payment_settings where singleton),false) then return null;end if;
 update public.lockd_test_payment_events set state='dead_letter',lease_token=null,lease_until=null
 where state='processing' and lease_until<=now() and attempts>=8;
 select * into j from public.lockd_test_payment_events where attempts<8 and ((state in ('pending','retry') and available_at<=now()) or (state='processing' and lease_until<=now()))
 order by available_at,created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.lockd_test_payment_events set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=j.id returning * into j;
 select reference into r from public.lockd_test_payment_intents where id=j.intent_id;
 return jsonb_build_object('id',j.id,'lease',j.lease_token,'reference',r);
end $$;

create function public.finish_lockd_test_payment_event(p_id uuid,p_lease uuid,p_reference text,p_provider_id text,p_amount_minor bigint,p_currency text,p_status text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.lockd_test_payment_events%rowtype; i public.lockd_test_payment_intents%rowtype; outcome text; problem text;
begin
 select * into j from public.lockd_test_payment_events where id=p_id for update;
 if not found or j.state<>'processing' or j.lease_token is distinct from p_lease or j.lease_until<=now() then raise exception 'Event lease expired.';end if;
 select * into i from public.lockd_test_payment_intents where id=j.intent_id for update;
 if p_reference is distinct from i.reference or p_provider_id is null or p_provider_id !~ '^[1-9][0-9]{0,18}$'
 or p_status is null or p_status not in ('abandoned','failed','ongoing','pending','processing','queued','reversed','success') then raise exception 'Invalid verified response.';end if;
 if p_amount_minor is distinct from i.amount_minor or p_currency is distinct from i.currency then problem:='amount_mismatch';
 elsif (i.provider_id is not null and i.provider_id<>p_provider_id) or exists(select 1 from public.lockd_test_payment_intents where provider_id=p_provider_id and id<>i.id) then problem:='reference_conflict';end if;
 if problem is not null then
  update public.lockd_test_payment_intents set state='review_required',updated_at=now() where id=i.id;
  update public.lockd_test_payment_events set state='dead_letter',last_error=problem,lease_token=null,lease_until=null,finished_at=now() where id=j.id;
  return jsonb_build_object('state','review_required');
 end if;
 -- Success may reverse, but an old pending/failed response cannot downgrade it.
 outcome:=case when p_status='reversed' then 'reversed' when p_status='success' then 'verified'
 when p_status in ('failed','abandoned') then 'failed' else 'pending' end;
 if i.state='review_required' or (i.state='reversed' and outcome<>'reversed') then outcome:='review_required';
 elsif i.state='verified' and outcome not in ('verified','reversed') then outcome:='verified';end if;
 if outcome='verified' and (i.expires_at<=now() or not exists(select 1 from public.lockd_bookings b where b.id=i.booking_id and b.status='awaiting_payment' and b.expires_at>now() and b.payment_status='unpaid' and public.lockd_trust_ready(b))) then outcome:='review_required';end if;
 insert into public.lockd_test_payment_journal(intent_id,event_id,provider_id,provider_status,amount_minor,currency)
 values(i.id,j.id,p_provider_id,p_status,p_amount_minor,p_currency) on conflict(intent_id,provider_id,provider_status) do nothing;
 update public.lockd_test_payment_intents set state=outcome,provider_id=p_provider_id,provider_status=p_status,updated_at=now() where id=i.id;
 update public.lockd_test_payment_events set state=case when outcome='pending' and attempts<8 then 'retry' when outcome='pending' then 'dead_letter' else 'complete' end,
 available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),lease_token=null,lease_until=null,finished_at=case when outcome<>'pending' then now() else null end,last_error=null where id=j.id;
 -- Never update lockd_bookings, production payment status, deposits or payouts.
 return jsonb_build_object('state',outcome,'bookingAuthorized',false);
end $$;

create function public.retry_lockd_test_payment_event(p_id uuid,p_lease uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.lockd_test_payment_events set state=case when attempts>=8 then 'dead_letter' else 'retry' end,
 available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),last_error='provider_unavailable',lease_token=null,lease_until=null
 where id=p_id and state='processing' and lease_token=p_lease and lease_until>now();
 if not found then raise exception 'Event lease expired.';end if;
end $$;
revoke all on function public.register_lockd_test_payment(uuid,uuid),public.enqueue_lockd_test_payment_event(text,text),public.claim_lockd_test_payment_event(),public.finish_lockd_test_payment_event(uuid,uuid,text,text,bigint,text,text),public.retry_lockd_test_payment_event(uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_lockd_test_payment(uuid,uuid),public.enqueue_lockd_test_payment_event(text,text),public.claim_lockd_test_payment_event(),public.finish_lockd_test_payment_event(uuid,uuid,text,text,bigint,text,text),public.retry_lockd_test_payment_event(uuid,uuid) to service_role;
commit;
