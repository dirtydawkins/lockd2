begin;
-- One private, replaceable profile photo per existing Supabase identity.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lockd-avatars','lockd-avatars',false,524288,array['image/webp']) on conflict(id) do nothing;
do $$begin
 if not exists(select 1 from storage.buckets where id='lockd-avatars' and not public and file_size_limit=524288 and allowed_mime_types=array['image/webp']) then
  raise exception 'Review the existing profile-photo bucket configuration before continuing.';
 end if;
end $$;
create policy lockd_avatar_owner_read on storage.objects for select to authenticated
using(bucket_id='lockd-avatars' and name=(select auth.uid())::text||'/avatar.webp');
create policy lockd_avatar_owner_insert on storage.objects for insert to authenticated
with check(bucket_id='lockd-avatars' and name=(select auth.uid())::text||'/avatar.webp');
create policy lockd_avatar_owner_update on storage.objects for update to authenticated
using(bucket_id='lockd-avatars' and name=(select auth.uid())::text||'/avatar.webp')
with check(bucket_id='lockd-avatars' and name=(select auth.uid())::text||'/avatar.webp');
create policy lockd_avatar_owner_delete on storage.objects for delete to authenticated
using(bucket_id='lockd-avatars' and name=(select auth.uid())::text||'/avatar.webp');
commit;
