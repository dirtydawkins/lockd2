-- Public host aliases are opt-in. Private renter accounts are never a directory.
begin;
alter table public.lockd_user_profiles add column host_slug text unique check(host_slug is null or host_slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
 add column host_name text check(length(host_name) between 2 and 80), add column host_bio text not null default '' check(length(host_bio)<=600),
 add column host_public boolean not null default false, add column host_consent_at timestamptz;
create function public.save_lockd_host_profile(p_slug text,p_name text,p_bio text,p_public boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.lockd_listings where owner_id=auth.uid()) then raise exception 'Create a listing before adding a host profile.'; end if;
 if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,49}$' or length(trim(coalesce(p_name,''))) not between 2 and 80 or length(coalesce(p_bio,''))>600 or p_public is null then raise exception 'Choose a host name, profile link and short introduction.'; end if;
 update public.lockd_user_profiles set host_slug=p_slug,host_name=trim(p_name),host_bio=trim(coalesce(p_bio,'')),host_public=p_public,host_consent_at=case when p_public then now() else null end where user_id=auth.uid();
 if not found then raise exception 'Finish your account profile first.'; end if;
end $$;
create function public.my_lockd_host_profile() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('slug',host_slug,'name',host_name,'bio',host_bio,'public',host_public) from public.lockd_user_profiles where user_id=auth.uid()
$$;
create function public.search_lockd_public_hosts(p_q text default '',p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare term text:=replace(replace(left(trim(coalesce(p_q,'')),100),'%',''),'_','');
begin
 if p_page is null or p_page<0 or p_page>1000 then raise exception 'Invalid page.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select p.host_slug slug,p.host_name name,p.host_bio bio,count(l.id)::integer listing_count
 from public.lockd_user_profiles p join public.lockd_listings l on l.owner_id=p.user_id and l.listing_status='published' and l.approval_status='approved'
 where p.host_public and p.host_consent_at is not null and p.host_slug is not null and p.host_name is not null
 and (term='' or p.host_name ilike '%'||term||'%' or p.host_slug ilike '%'||term||'%')
 group by p.user_id,p.host_slug,p.host_name,p.host_bio
 order by case when lower(p.host_name)=lower(term) then 0 when p.host_name ilike term||'%' then 1 else 2 end,p.host_name,p.host_slug
 limit 21 offset p_page*20)x),'[]');
end $$;
create function public.lockd_public_host_listings(p_slug text,p_page integer default 0) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_page is null or p_page<0 or p_page>1000 then raise exception 'Invalid page.'; end if;
 select jsonb_build_object('slug',p.host_slug,'name',p.host_name,'bio',p.host_bio,'listingIds',coalesce((select jsonb_agg(x.id) from (select l.id from public.lockd_listings l where l.owner_id=p.user_id and l.listing_status='published' and l.approval_status='approved' order by l.created_at desc,l.id limit 25 offset p_page*24)x),'[]')) into result
 from public.lockd_user_profiles p where p.host_public and p.host_consent_at is not null and p.host_slug=p_slug
 and exists(select 1 from public.lockd_listings l where l.owner_id=p.user_id and l.listing_status='published' and l.approval_status='approved');
 return result;
end $$;
revoke all on function public.save_lockd_host_profile(text,text,text,boolean),public.my_lockd_host_profile(),public.search_lockd_public_hosts(text,integer),public.lockd_public_host_listings(text,integer) from public,anon,authenticated;
grant execute on function public.save_lockd_host_profile(text,text,text,boolean),public.my_lockd_host_profile() to authenticated;
grant execute on function public.search_lockd_public_hosts(text,integer),public.lockd_public_host_listings(text,integer) to anon,authenticated;
commit;
