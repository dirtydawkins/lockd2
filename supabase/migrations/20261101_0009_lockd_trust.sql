-- Additive trust gates. Requires 0008. No provider calls, invented thresholds or KYC data.
begin;
create table public.lockd_verification_policies (
 id bigint generated always as identity primary key,
 category text not null check(category in ('stay','drive','play','technology','experience','camera','phone','laptop','audio','creative','other')),
 version integer not null check(version>0),
 enabled boolean not null,
 replacement_value_threshold numeric(14,2) check(replacement_value_threshold between 0 and 999999999999.99),
 rental_duration_threshold integer check(rental_duration_threshold between 1 and 366),
 identity_required boolean not null default false,
 address_required boolean not null default false,
 owner_approval_required boolean not null default true,
 platform_approval_required boolean not null default true,
 manual_review_required boolean not null default true,
 handover_required boolean not null default true,
 minimum_deposit numeric(14,2) not null default 0 check(minimum_deposit between 0 and 999999999999.99),
 maximum_duration integer check(maximum_duration between 1 and 366),
 verification_max_age_days integer not null default 365 check(verification_max_age_days between 1 and 1095),
 approval_valid_hours integer not null default 24 check(approval_valid_hours between 1 and 72),
 conditions text not null default '' check(length(conditions)<=2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(category,version)
);
-- Policy versions and evidence decisions are append-only; latest version is authoritative.
create index lockd_policy_current on public.lockd_verification_policies(category,version desc);
create table public.lockd_listing_trust_values (
 listing_id uuid primary key references public.lockd_listings(id) on delete restrict,
 replacement_value_kes numeric(14,2) not null check(replacement_value_kes between 0 and 999999999999.99),
 recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default now()
);
create table public.lockd_verification_passport (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 record_sequence bigint generated always as identity unique,
 kind text not null check(kind in ('identity','address')),
 outcome text not null check(outcome in ('verified','review_required','revoked')),
 source text not null check(source in ('manual_review','persona')),
 environment text not null check(environment in ('sandbox','production')),
 evidence_reference text not null check(length(trim(evidence_reference)) between 1 and 200),
 verified_at timestamptz not null default now(), expires_at timestamptz not null,
 recorded_by uuid references auth.users(id), check(expires_at>verified_at)
);
create index lockd_passport_latest on public.lockd_verification_passport(user_id,kind,record_sequence desc);
create table public.lockd_trust_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id), booking_id uuid references public.lockd_bookings(id) on delete restrict,
 event_type text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.lockd_verification_policies enable row level security;
alter table public.lockd_listing_trust_values enable row level security;
alter table public.lockd_verification_passport enable row level security;
alter table public.lockd_trust_audit enable row level security;
revoke all on public.lockd_verification_policies,public.lockd_listing_trust_values,public.lockd_verification_passport,public.lockd_trust_audit from public,anon,authenticated;

create function public.lockd_require_trust_admin() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'Administrator access required.'; end if;
end $$;
create function public.lockd_immutable_trust_record() returns trigger language plpgsql as $$
begin raise exception 'Trust history is append-only.'; end $$;
create trigger lockd_policy_immutable before update or delete on public.lockd_verification_policies for each row execute function public.lockd_immutable_trust_record();
create trigger lockd_passport_immutable before update or delete on public.lockd_verification_passport for each row execute function public.lockd_immutable_trust_record();
create trigger lockd_trust_audit_immutable before update or delete on public.lockd_trust_audit for each row execute function public.lockd_immutable_trust_record();

create function public.configure_lockd_verification_policy(p_policy jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.lockd_verification_policies%rowtype; v integer; k text;
begin
 perform public.lockd_require_trust_admin();
 if jsonb_typeof(p_policy)<>'object' or length(p_policy::text)>6000 then raise exception 'Invalid policy.'; end if;
 for k in select jsonb_object_keys(p_policy) loop
  if k not in ('category','enabled','replacement_value_threshold','rental_duration_threshold','identity_required','address_required','owner_approval_required','platform_approval_required','manual_review_required','handover_required','minimum_deposit','maximum_duration','verification_max_age_days','approval_valid_hours','conditions') then raise exception 'Invalid policy field.'; end if;
  if k in ('enabled','identity_required','address_required','owner_approval_required','platform_approval_required','manual_review_required','handover_required') and jsonb_typeof(p_policy->k)<>'boolean' then raise exception 'Invalid policy field.'; end if;
  if k in ('category','conditions') and jsonb_typeof(p_policy->k)<>'string' then raise exception 'Invalid policy field.'; end if;
  if k in ('replacement_value_threshold','rental_duration_threshold','minimum_deposit','maximum_duration','verification_max_age_days','approval_valid_hours') and jsonb_typeof(p_policy->k) not in ('number','null') then raise exception 'Invalid policy field.'; end if;
 end loop;
 if not (p_policy ? 'enabled') then raise exception 'Policy enabled state is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('policy:'||(p_policy->>'category'),0));
 select coalesce(max(version),0)+1 into v from public.lockd_verification_policies where category=p_policy->>'category';
 insert into public.lockd_verification_policies(category,version,enabled,replacement_value_threshold,rental_duration_threshold,
 identity_required,address_required,owner_approval_required,platform_approval_required,manual_review_required,handover_required,
 minimum_deposit,maximum_duration,verification_max_age_days,approval_valid_hours,conditions,created_by)
 values(p_policy->>'category',v,(p_policy->>'enabled')::boolean,(p_policy->>'replacement_value_threshold')::numeric,(p_policy->>'rental_duration_threshold')::integer,
 coalesce((p_policy->>'identity_required')::boolean,false),coalesce((p_policy->>'address_required')::boolean,false),coalesce((p_policy->>'owner_approval_required')::boolean,true),
 coalesce((p_policy->>'platform_approval_required')::boolean,true),coalesce((p_policy->>'manual_review_required')::boolean,true),coalesce((p_policy->>'handover_required')::boolean,true),
 coalesce((p_policy->>'minimum_deposit')::numeric,0),(p_policy->>'maximum_duration')::integer,coalesce((p_policy->>'verification_max_age_days')::integer,365),
 coalesce((p_policy->>'approval_valid_hours')::integer,24),coalesce(p_policy->>'conditions',''),auth.uid()) returning * into p;
 insert into public.lockd_trust_audit(actor_id,event_type,details) values(auth.uid(),'policy_version_created',jsonb_build_object('policyId',p.id,'category',p.category,'version',v));
 return to_jsonb(p);
end $$;

create function public.record_lockd_listing_trust_value(p_listing_id uuid,p_value numeric) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.lockd_require_trust_admin();
 perform 1 from public.lockd_listings where id=p_listing_id for update;
 if not found or p_value is null or p_value<0 or p_value>999999999999.99 then raise exception 'Invalid replacement value.'; end if;
 insert into public.lockd_listing_trust_values values(p_listing_id,p_value,auth.uid(),now())
 on conflict(listing_id) do update set replacement_value_kes=excluded.replacement_value_kes,recorded_by=excluded.recorded_by,recorded_at=now();
 insert into public.lockd_trust_audit(actor_id,event_type,details) values(auth.uid(),'replacement_value_recorded',jsonb_build_object('listingId',p_listing_id,'valueKes',p_value));
end $$;

-- Only a qualified human reviewer may attest to evidence through this RPC.
-- Sandbox evidence can NEVER satisfy a production booking gate.
create function public.record_lockd_manual_verification(p_user_id uuid,p_kind text,p_outcome text,p_reference text,p_valid_days integer,p_environment text default 'production')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 perform public.lockd_require_trust_admin();
 if p_user_id=auth.uid() then raise exception 'A different reviewer is required.'; end if;
 if p_valid_days is null or p_valid_days not between 1 and 365 then raise exception 'Invalid verification validity.'; end if;
 insert into public.lockd_verification_passport(user_id,kind,outcome,source,environment,evidence_reference,expires_at,recorded_by)
 values(p_user_id,p_kind,p_outcome,'manual_review',p_environment,p_reference,now()+make_interval(days=>p_valid_days),auth.uid()) returning id into result;
 insert into public.lockd_trust_audit(actor_id,event_type,details) values(auth.uid(),'manual_verification_recorded',jsonb_build_object('verificationId',result,'kind',p_kind,'outcome',p_outcome));
 return result;
end $$;

alter table public.lockd_bookings
 add column trust_policy_id bigint references public.lockd_verification_policies(id),
 add column trust_requirements jsonb not null default '{}',
 add column owner_approval text not null default 'not_required' check(owner_approval in ('not_required','pending','approved','rejected')),
 add column platform_approval text not null default 'not_required' check(platform_approval in ('not_required','pending','approved','rejected')),
 add column owner_approved_at timestamptz,
 add column platform_approved_at timestamptz,
 add column booking_conditions text not null default '',
 add column conditions_accepted_at timestamptz;
update public.lockd_bookings set owner_approval='pending' where status='pending_owner';

create function public.lockd_effective_trust_policy(p_listing_id uuid,p_days integer) returns public.lockd_verification_policies language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.lockd_verification_policies%rowtype; value numeric;
begin
 select x.* into p from public.lockd_verification_policies x join public.lockd_listings l on l.category=x.category where l.id=p_listing_id order by version desc limit 1;
 if not found or not p.enabled then return null; end if;
 select replacement_value_kes into value from public.lockd_listing_trust_values where listing_id=p_listing_id;
 -- Unknown value fails closed whenever a value threshold applies. No owner-supplied value is trusted.
 if (p.replacement_value_threshold is null and p.rental_duration_threshold is null)
 or (p.replacement_value_threshold is not null and (value is null or value>=p.replacement_value_threshold))
 or (p.rental_duration_threshold is not null and p_days>=p.rental_duration_threshold) then return p; end if;
 return null;
end $$;
create function public.lockd_passport_valid(p_user uuid,p_kind text,p_age integer) returns boolean language sql security definer set search_path=public,pg_temp as $$
 select coalesce((select outcome='verified' and environment='production' and expires_at>now() and verified_at>now()-make_interval(days=>p_age)
 from public.lockd_verification_passport where user_id=p_user and kind=p_kind and environment='production' order by record_sequence desc limit 1),false)
$$;
create function public.lockd_trust_ready(b public.lockd_bookings) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.lockd_verification_policies%rowtype; current_policy public.lockd_verification_policies%rowtype;
begin
 current_policy:=public.lockd_effective_trust_policy(b.listing_id,b.end_date-b.start_date);
 -- Confirmed contracts retain their agreed version. Pending requests must use current rules.
 if not exists(select 1 from public.lockd_bookings where id=b.id and status in ('confirmed','active','completed','disputed'))
 and current_policy.id is distinct from b.trust_policy_id then return false; end if;
 if b.owner_approval not in ('approved','not_required') or b.platform_approval not in ('approved','not_required') then return false; end if;
 if b.booking_conditions<>'' and b.conditions_accepted_at is null then return false; end if;
 if b.trust_policy_id is null then return true; end if;
 select * into p from public.lockd_verification_policies where id=b.trust_policy_id;
 if (b.owner_approval='approved' and (b.owner_approved_at is null or b.owner_approved_at+make_interval(hours=>p.approval_valid_hours)<=now()))
 or (b.platform_approval='approved' and (b.platform_approved_at is null or b.platform_approved_at+make_interval(hours=>p.approval_valid_hours)<=now())) then return false; end if;
 return (not p.identity_required or public.lockd_passport_valid(b.customer_id,'identity',p.verification_max_age_days))
 and (not p.address_required or public.lockd_passport_valid(b.customer_id,'address',p.verification_max_age_days));
end $$;
create function public.lockd_guard_booking_trust() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.lockd_verification_policies%rowtype; needs_owner boolean;
begin
 if tg_op='INSERT' then
  p:=public.lockd_effective_trust_policy(new.listing_id,new.end_date-new.start_date);
  select requires_approval into needs_owner from public.lockd_listings where id=new.listing_id;
  new.trust_policy_id:=p.id;
  new.owner_approval:=case when needs_owner or coalesce(p.owner_approval_required,false) then 'pending' else 'not_required' end;
  new.platform_approval:=case when coalesce(p.platform_approval_required or p.manual_review_required,false) then 'pending' else 'not_required' end;
  new.booking_conditions:=coalesce(p.conditions,''); new.conditions_accepted_at:=null;
  new.trust_requirements:=case when p.id is null then '{}'::jsonb else jsonb_build_object('identity',p.identity_required,'address',p.address_required,'handover',p.handover_required,'version',p.version) end;
  if p.maximum_duration is not null and new.end_date-new.start_date>p.maximum_duration then raise exception 'This rental exceeds the verification policy duration limit.'; end if;
  if p.minimum_deposit>coalesce(new.deposit_amount,0) then raise exception 'The listing deposit does not meet the rental policy. Contact support.'; end if;
  if not public.lockd_trust_ready(new) then
   new.status:='pending_owner'; new.expires_at:=now()+make_interval(hours=>(select approval_hold_hours from public.lockd_booking_settings where singleton));
  end if;
 elsif new.status in ('awaiting_payment','confirmed','active') and (new.status is distinct from old.status
 or (new.status='awaiting_payment' and new.payment_status is distinct from old.payment_status and new.payment_status in ('processing','paid'))) then
  if not public.lockd_trust_ready(new) then raise exception 'Verification, conditions and both required approvals must be current.'; end if;
 end if;
 return new;
end $$;
create trigger lockd_booking_trust_guard before insert or update on public.lockd_bookings for each row execute function public.lockd_guard_booking_trust();

-- Extend the original transition function instead of duplicating the booking engine.
alter function public.transition_lockd_booking(uuid,text) rename to lockd_transition_booking_base;
revoke all on function public.lockd_transition_booking_base(uuid,text) from public,anon,authenticated;
create function public.transition_lockd_booking(p_booking_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; lid uuid;
begin
 if p_action='dispute' then raise exception 'A dispute description is required.'; end if;
 if p_action='reject' then
  perform public.lockd_transition_booking_base(p_booking_id,p_action);
  select * into b from public.lockd_bookings where id=p_booking_id;
  if b.status='rejected' then update public.lockd_bookings set owner_approval='rejected' where id=p_booking_id returning * into b; end if;
  return to_jsonb(b);
 end if;
 if p_action not in ('accept','accept_conditions','continue') then return public.lockd_transition_booking_base(p_booking_id,p_action); end if;
 select listing_id into lid from public.lockd_bookings where id=p_booking_id and auth.uid() in (customer_id,owner_id);
 if not found then raise exception 'Reservation not found.'; end if;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 if (b.status<>'confirmed' and (b.status<>'pending_owner' or b.expires_at<=now())) or (b.status='confirmed' and (p_action<>'accept' or b.payment_status<>'paid' or current_date>=b.end_date)) then raise exception 'This reservation change is not permitted.'; end if;
 if p_action='accept' and auth.uid()=b.owner_id and b.owner_approval in ('pending','approved') then b.owner_approval:='approved'; b.owner_approved_at:=now();
 elsif p_action='accept_conditions' and auth.uid()=b.customer_id and b.booking_conditions<>'' then b.conditions_accepted_at:=now();
 elsif p_action='continue' and auth.uid()=b.customer_id then null;
 else raise exception 'This reservation change is not permitted.'; end if;
 if b.status='pending_owner' and public.lockd_trust_ready(b) then
  if not exists(select 1 from public.lockd_listings where id=lid and listing_status='published' and approval_status='approved') then raise exception 'This listing is no longer published.'; end if;
  b.status:='awaiting_payment'; b.expires_at:=now()+make_interval(mins=>(select payment_hold_minutes from public.lockd_booking_settings where singleton));
 end if;
 update public.lockd_bookings set owner_approval=b.owner_approval,owner_approved_at=b.owner_approved_at,conditions_accepted_at=b.conditions_accepted_at,status=b.status,expires_at=b.expires_at,updated_at=now() where id=b.id returning * into b;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type) values(auth.uid(),b.id,p_action);
 return to_jsonb(b);
end $$;

create function public.review_lockd_booking(p_booking_id uuid,p_decision text,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; lid uuid;
begin
 perform public.lockd_require_trust_admin();
 if p_decision is null or p_decision not in ('approved','rejected') or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'A review decision and reason are required.'; end if;
 select listing_id into lid from public.lockd_bookings where id=p_booking_id;
 perform 1 from public.lockd_listings where id=lid for update;
 select * into b from public.lockd_bookings where id=p_booking_id for update;
 if not found then raise exception 'Reservation not found.'; end if;
 if auth.uid() in (b.owner_id,b.customer_id) then raise exception 'A different reviewer is required.'; end if;
 if (b.status='pending_owner' and (b.platform_approval not in ('pending','approved') or b.expires_at<=now()))
 or (b.status='confirmed' and (p_decision<>'approved' or b.platform_approval<>'approved' or b.payment_status<>'paid' or current_date>=b.end_date))
 or b.status not in ('pending_owner','confirmed') then raise exception 'This reservation change is not permitted.'; end if;
 b.platform_approval:=p_decision; b.platform_approved_at:=now();
 if p_decision='rejected' then b.status:='rejected';
 elsif b.status='pending_owner' and public.lockd_trust_ready(b) then b.status:='awaiting_payment'; b.expires_at:=now()+make_interval(mins=>(select payment_hold_minutes from public.lockd_booking_settings where singleton)); end if;
 update public.lockd_bookings set platform_approval=b.platform_approval,platform_approved_at=b.platform_approved_at,status=b.status,expires_at=b.expires_at,updated_at=now() where id=b.id returning * into b;
 insert into public.lockd_trust_audit(actor_id,booking_id,event_type,details) values(auth.uid(),b.id,'platform_review',jsonb_build_object('decision',p_decision,'reason',p_reason));
 return to_jsonb(b);
end $$;

create function public.my_lockd_verification() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view verification.'; end if;
 return jsonb_build_object('identityVerified',public.lockd_passport_valid(auth.uid(),'identity',365),'addressVerified',public.lockd_passport_valid(auth.uid(),'address',365),
 'checks',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'outcome',outcome,'environment',environment,'verifiedAt',verified_at,'expiresAt',expires_at)) from
 (select distinct on(kind,environment) * from public.lockd_verification_passport where user_id=auth.uid() order by kind,environment,record_sequence desc) x),'[]'::jsonb));
end $$;
create function public.my_lockd_rental_checks(p_booking_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype; p public.lockd_verification_policies%rowtype;
begin
 select * into b from public.lockd_bookings where id=p_booking_id and auth.uid() in (customer_id,owner_id);
 if not found then raise exception 'Reservation not found.'; end if;
 select * into p from public.lockd_verification_policies where id=b.trust_policy_id;
 return jsonb_build_object('status',case when b.status in ('pending_owner','awaiting_payment') and b.expires_at<=now() then 'expired' else b.status end,
 'isOwner',auth.uid()=b.owner_id,'policyVersion',p.version,'identityRequired',coalesce(p.identity_required,false),'addressRequired',coalesce(p.address_required,false),
 'identityCurrent',public.lockd_passport_valid(b.customer_id,'identity',coalesce(p.verification_max_age_days,365)),
 'addressCurrent',public.lockd_passport_valid(b.customer_id,'address',coalesce(p.verification_max_age_days,365)),
 'ownerApproval',b.owner_approval,'platformApproval',b.platform_approval,'conditions',b.booking_conditions,'conditionsAccepted',b.conditions_accepted_at is not null,
 'paymentStatus',b.payment_status,'readyForPayment',b.status='awaiting_payment' and b.expires_at>now() and public.lockd_trust_ready(b),
 'handoverAvailable',b.payment_status='paid' and ((b.status='confirmed' and current_date>=b.start_date and current_date<b.end_date and public.lockd_trust_ready(b)) or b.status in ('active','disputed')));
end $$;
create function public.lockd_trust_admin_overview() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.lockd_require_trust_admin();
 return jsonb_build_object('policies',coalesce((select jsonb_agg(to_jsonb(x)) from (select distinct on(category) * from public.lockd_verification_policies order by category,version desc)x),'[]'),
 'reviews',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,customer_id,listing_snapshot,start_date,end_date,trust_policy_id,owner_approval,platform_approval,expires_at from public.lockd_bookings
 where (platform_approval='pending' and status='pending_owner' and expires_at>now()) or (platform_approval='approved' and status='confirmed' and end_date>current_date) order by created_at limit 100)x),'[]'));
end $$;

revoke all on function public.lockd_require_trust_admin(),public.lockd_immutable_trust_record(),public.lockd_effective_trust_policy(uuid,integer),public.lockd_passport_valid(uuid,text,integer),public.lockd_trust_ready(public.lockd_bookings),public.lockd_guard_booking_trust(),public.configure_lockd_verification_policy(jsonb),public.record_lockd_listing_trust_value(uuid,numeric),public.record_lockd_manual_verification(uuid,text,text,text,integer,text),public.transition_lockd_booking(uuid,text),public.review_lockd_booking(uuid,text,text),public.my_lockd_verification(),public.lockd_trust_admin_overview(),public.my_lockd_rental_checks(uuid) from public,anon,authenticated;
grant execute on function public.configure_lockd_verification_policy(jsonb),public.record_lockd_listing_trust_value(uuid,numeric),public.record_lockd_manual_verification(uuid,text,text,text,integer,text),public.transition_lockd_booking(uuid,text),public.review_lockd_booking(uuid,text,text),public.my_lockd_verification(),public.lockd_trust_admin_overview(),public.my_lockd_rental_checks(uuid) to authenticated;
commit;
