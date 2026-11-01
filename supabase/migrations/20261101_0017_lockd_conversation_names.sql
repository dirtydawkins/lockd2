-- A participant may search only their existing conversation counterparties.
begin;
alter function public.my_lockd_conversations() rename to lockd_my_conversations_v1;
revoke all on function public.lockd_my_conversations_v1() from public,anon,authenticated;
create function public.my_lockd_conversations() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue.';end if;
 return coalesce((select jsonb_agg(item||jsonb_build_object('participant_name',coalesce(p.host_name,p.display_name)))
 from jsonb_array_elements(public.lockd_my_conversations_v1()) item
 join public.lockd_conversations c on c.id=(item->>'id')::uuid and auth.uid() in(c.customer_id,c.owner_id)
 left join public.lockd_user_profiles p on p.user_id=case when c.customer_id=auth.uid() then c.owner_id else c.customer_id end),'[]');
end $$;
revoke all on function public.my_lockd_conversations() from public,anon;
grant execute on function public.my_lockd_conversations() to authenticated;
commit;
