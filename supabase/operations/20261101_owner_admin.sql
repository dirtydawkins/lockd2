-- Operator-only bootstrap. Requires the owner's explicit action-time approval.
-- No passwords, API keys or identity documents. Existing metadata is preserved.
begin;
do $$
declare target uuid; matches integer;
begin
  select count(*) into matches from auth.users where lower(email)='elorengo26@gmail.com';
  if matches <> 1 then raise exception 'Expected exactly one existing owner account.'; end if;
  select id into target from auth.users where lower(email)='elorengo26@gmail.com' and email_confirmed_at is not null;
  if target is null then raise exception 'Owner email must be confirmed before granting administrator access.'; end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('role','admin') where id=target;
end $$;
select count(*) as administrator_count from auth.users where raw_app_meta_data->>'role'='admin';
commit;
