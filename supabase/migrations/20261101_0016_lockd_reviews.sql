-- Genuine completed-rental reviews. No reviews or business records are seeded.
begin;
create table public.lockd_review_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false,policy_version text,policy_approved_at timestamptz);
insert into public.lockd_review_settings(singleton) values(true);
create table public.lockd_reviews(
 id uuid primary key default gen_random_uuid(),booking_id uuid not null unique references public.lockd_bookings(id) on delete restrict,
 reviewer_id uuid not null references auth.users(id),owner_id uuid not null references auth.users(id),listing_id uuid not null references public.lockd_listings(id),
 reviewer_label text not null,category text not null,rating smallint not null check(rating between 1 and 5),dimensions jsonb not null default '{}',
 body text not null check(length(trim(body)) between 10 and 3000),status text not null default 'pending' check(status in ('pending','published','hidden')),
 version integer not null default 1,moderated_by uuid references auth.users(id),moderation_reason text,appealed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(reviewer_id<>owner_id)
);
create table public.lockd_review_responses(review_id uuid primary key references public.lockd_reviews(id),owner_id uuid not null references auth.users(id),body text not null check(length(trim(body)) between 5 and 2000),status text not null default 'pending' check(status in ('pending','published','hidden')),created_at timestamptz not null default now(),moderated_by uuid references auth.users(id));
create table public.lockd_review_reports(id uuid primary key default gen_random_uuid(),review_id uuid not null references public.lockd_reviews(id),reporter_id uuid not null references auth.users(id),reason text not null check(length(trim(reason)) between 10 and 1000),created_at timestamptz not null default now(),unique(review_id,reporter_id));
create table public.lockd_review_audit(id bigint generated always as identity primary key,review_id uuid not null references public.lockd_reviews(id),actor_id uuid not null references auth.users(id),event text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create index lockd_review_public_listing on public.lockd_reviews(listing_id,created_at desc) where status='published';
create index lockd_review_customer on public.lockd_reviews(reviewer_id,created_at desc);
create trigger lockd_review_audit_immutable before update or delete on public.lockd_review_audit for each row execute function public.lockd_immutable_trust_record();
create function public.lockd_reviews_ready() returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.lockd_review_settings where singleton and enabled and policy_approved_at is not null and policy_version is not null) $$;
create function public.lockd_reviews_capabilities() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$ select jsonb_build_object('enabled',public.lockd_reviews_ready(),'configured',true) $$;
create function public.lockd_can_review(p_booking uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.lockd_reviews_ready() and exists(select 1 from public.lockd_bookings b where b.id=p_booking and b.customer_id=p_user and b.owner_id<>p_user and b.status='completed' and b.payment_status in ('paid','refunding','refunded')
 and exists(select 1 from public.lockd_booking_events where booking_id=b.id and status='completed')
 and exists(select 1 from public.lockd_handover_records where booking_id=b.id and phase='out' and owner_acknowledged_at is not null and customer_acknowledged_at is not null)
 and exists(select 1 from public.lockd_handover_records where booking_id=b.id and phase='return' and owner_acknowledged_at is not null and customer_acknowledged_at is not null))
$$;
create function public.my_lockd_review_opportunities() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.';end if;
 return jsonb_build_object('enabled',public.lockd_reviews_ready(),'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select b.id,b.listing_snapshot->>'title' title,b.listing_snapshot->>'category' category from public.lockd_bookings b where b.customer_id=auth.uid() and public.lockd_can_review(b.id,auth.uid()) and not exists(select 1 from public.lockd_reviews where booking_id=b.id) order by b.updated_at desc limit 50)x),'[]'));
end $$;
create function public.submit_lockd_review(p_booking uuid,p_rating integer,p_body text,p_dimensions jsonb default '{}') returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.lockd_bookings%rowtype;r public.lockd_reviews%rowtype;k text;v jsonb;allowed text[];cat text;display text;
begin
 select * into b from public.lockd_bookings where id=p_booking and customer_id=auth.uid() for update;
 if not found or not public.lockd_can_review(b.id,auth.uid()) then raise exception 'Only completed rentals can be reviewed.';end if;
 if p_rating is null or p_rating not between 1 and 5 or length(trim(coalesce(p_body,''))) not between 10 and 3000 or p_dimensions is null or jsonb_typeof(p_dimensions)<>'object' then raise exception 'Add a rating and a review between 10 and 3000 characters.';end if;
 cat:=coalesce(b.listing_snapshot->>'category',(select category from public.lockd_listings where id=b.listing_id),'other');
 allowed:=case cat when 'stay' then array['cleanliness','accuracy','check_in','communication'] when 'drive' then array['condition','accuracy','pickup'] when 'experience' then array['accuracy','organization','communication'] else array['condition','accuracy','handover'] end;
 for k,v in select * from jsonb_each(p_dimensions) loop if not(k=any(allowed)) or jsonb_typeof(v)<>'number' or v::text !~ '^[1-5]$' then raise exception 'Choose valid feedback for this category.';end if;end loop;
 select * into r from public.lockd_reviews where booking_id=b.id;
 if found then if r.reviewer_id=auth.uid() and r.rating=p_rating and r.body=trim(p_body) and r.dimensions=p_dimensions then return r.id;end if;raise exception 'This rental already has your review.';end if;
 select split_part(display_name,' ',1) into display from public.lockd_user_profiles where user_id=auth.uid();
 if display is null or display !~ '^[[:alpha:]][[:alpha:]''-]{0,39}$' then display:='Renter';end if;
 insert into public.lockd_reviews(booking_id,reviewer_id,owner_id,listing_id,reviewer_label,category,rating,dimensions,body) values(b.id,auth.uid(),b.owner_id,b.listing_id,display,cat,p_rating,p_dimensions,trim(p_body)) returning * into r;
 insert into public.lockd_review_audit(review_id,actor_id,event) values(r.id,auth.uid(),'submitted');return r.id;
end $$;
create function public.my_lockd_reviews() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select r.id,r.booking_id,r.listing_id,r.rating,r.body,r.status,r.created_at,r.version,r.moderation_reason,r.appealed_at,r.reviewer_id=auth.uid() is_reviewer,l.title from public.lockd_reviews r left join public.lockd_listings l on l.id=r.listing_id where auth.uid() in (r.reviewer_id,r.owner_id) order by r.created_at desc limit 100)x),'[]');
end $$;
create function public.lockd_public_listing_reviews(p_listing uuid,p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_page is null or p_page<0 or p_page>1000 then raise exception 'Invalid review page.';end if;
 if not public.lockd_reviews_ready() then return jsonb_build_object('enabled',false);end if;
 if not exists(select 1 from public.lockd_listings where id=p_listing and listing_status='published' and approval_status='approved') then raise exception 'Rental unavailable.';end if;
 return jsonb_build_object('enabled',true,'count',(select count(*) from public.lockd_reviews where listing_id=p_listing and status='published'),'average',(select round(avg(rating),1) from public.lockd_reviews where listing_id=p_listing and status='published'),
 'distribution',(select jsonb_object_agg(n,(select count(*) from public.lockd_reviews where listing_id=p_listing and status='published' and rating=n)) from generate_series(1,5)n),
 'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select r.id,r.reviewer_label,r.rating,r.dimensions,r.body,r.created_at,s.body response from public.lockd_reviews r left join public.lockd_review_responses s on s.review_id=r.id and s.status='published' where r.listing_id=p_listing and r.status='published' order by r.created_at desc,r.id limit 20 offset p_page*20)x),'[]'));
end $$;
create function public.respond_lockd_review(p_review uuid,p_body text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_reviews%rowtype;
begin
 select * into r from public.lockd_reviews where id=p_review and owner_id=auth.uid() and status='published' for update;
 if not found or not public.lockd_reviews_ready() or length(trim(coalesce(p_body,''))) not between 5 and 2000 then raise exception 'Choose a published review and a response between 5 and 2000 characters.';end if;
 if exists(select 1 from public.lockd_review_responses where review_id=r.id) then raise exception 'A response has already been submitted.';end if;
 insert into public.lockd_review_responses(review_id,owner_id,body) values(r.id,auth.uid(),trim(p_body));
 insert into public.lockd_review_audit(review_id,actor_id,event) values(r.id,auth.uid(),'response_submitted');
end $$;
create function public.report_lockd_review(p_review uuid,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.lockd_reviews_ready() or not exists(select 1 from public.lockd_reviews where id=p_review and status='published') or length(trim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Choose a review and explain your report.';end if;
 if(select count(*) from public.lockd_review_reports where reporter_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'Please try again tomorrow.';end if;
 insert into public.lockd_review_reports(review_id,reporter_id,reason) values(p_review,auth.uid(),trim(p_reason)) on conflict(review_id,reporter_id) do nothing;
 -- Reports do not automatically hide criticism or change rentals/accounts.
end $$;
create function public.appeal_lockd_review(p_review uuid,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_reviews%rowtype;
begin
 select * into r from public.lockd_reviews where id=p_review and reviewer_id=auth.uid() for update;
 if not found or r.status<>'hidden' or r.appealed_at is not null or length(trim(coalesce(p_reason,''))) not between 10 and 1000 then raise exception 'Explain why this review should be reconsidered.';end if;
 update public.lockd_reviews set appealed_at=now(),status='pending',updated_at=now() where id=r.id;
 insert into public.lockd_review_audit(review_id,actor_id,event,details) values(r.id,auth.uid(),'appealed',jsonb_build_object('reason',trim(p_reason)));
end $$;
create function public.lockd_review_queue() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.lockd_require_trust_admin();
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select r.*,s.body response,s.status response_status,(select jsonb_agg(to_jsonb(a)) from public.lockd_review_audit a where a.review_id=r.id) audit,(select jsonb_agg(to_jsonb(p)) from public.lockd_review_reports p where p.review_id=r.id) reports from public.lockd_reviews r left join public.lockd_review_responses s on s.review_id=r.id where r.status='pending' or s.status='pending' or exists(select 1 from public.lockd_review_reports where review_id=r.id) order by r.created_at limit 100)x),'[]');
end $$;
create function public.moderate_lockd_review(p_review uuid,p_target text,p_status text,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.lockd_reviews%rowtype;
begin
 perform public.lockd_require_trust_admin();select * into r from public.lockd_reviews where id=p_review for update;
 if not found or auth.uid() in(r.owner_id,r.reviewer_id) or(r.appealed_at is not null and r.moderated_by=auth.uid()) then raise exception 'A different reviewer is required.';end if;
 if p_target is null or p_target not in('review','response') or p_status is null or p_status not in('published','hidden') or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Record a moderation decision and reason.';end if;
 if p_target='review' then update public.lockd_reviews set status=p_status,moderated_by=auth.uid(),moderation_reason=trim(p_reason),updated_at=now() where id=r.id;
 else update public.lockd_review_responses set status=p_status,moderated_by=auth.uid() where review_id=r.id;if not found then raise exception 'Response unavailable.';end if;end if;
 insert into public.lockd_review_audit(review_id,actor_id,event,details) values(r.id,auth.uid(),'moderated',jsonb_build_object('target',p_target,'status',p_status,'reason',trim(p_reason)));
end $$;
create function public.lockd_review_invitation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='completed' and old.status is distinct from new.status and public.lockd_can_review(new.id,new.customer_id)
 and not exists(select 1 from public.lockd_notifications where user_id=new.customer_id and booking_id=new.id and event_type='review_ready') then
 insert into public.lockd_notifications(user_id,booking_id,event_type,message) values(new.customer_id,new.id,'review_ready','Your rental is complete. You can now leave a review in your account.');end if;return new;
end $$;
create trigger lockd_review_invitation after update of status on public.lockd_bookings for each row execute function public.lockd_review_invitation();
do $$ declare f record;t text;begin
 foreach t in array array['lockd_review_settings','lockd_reviews','lockd_review_responses','lockd_review_reports','lockd_review_audit'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);end loop;
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname in('lockd_reviews_ready','lockd_can_review','my_lockd_review_opportunities','submit_lockd_review','my_lockd_reviews','lockd_public_listing_reviews','respond_lockd_review','report_lockd_review','appeal_lockd_review','lockd_review_queue','moderate_lockd_review','lockd_review_invitation') loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);end loop;
end $$;
grant execute on function public.my_lockd_review_opportunities(),public.submit_lockd_review(uuid,integer,text,jsonb),public.my_lockd_reviews(),public.respond_lockd_review(uuid,text),public.report_lockd_review(uuid,text),public.appeal_lockd_review(uuid,text),public.lockd_review_queue(),public.moderate_lockd_review(uuid,text,text,text) to authenticated;
grant execute on function public.lockd_public_listing_reviews(uuid,integer) to anon,authenticated;
revoke all on function public.lockd_reviews_capabilities() from public;
grant execute on function public.lockd_reviews_capabilities() to anon,authenticated;
commit;
