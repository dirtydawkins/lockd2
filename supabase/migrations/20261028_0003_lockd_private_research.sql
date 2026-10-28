-- Keep internal market research available only to explicitly assigned LOCKD admins.
-- Existing records are preserved; anonymous access is removed.

alter table public.lockd_market_price_benchmarks enable row level security;

drop policy if exists "Public can read published LOCKD market benchmarks"
  on public.lockd_market_price_benchmarks;

revoke all on public.lockd_market_price_benchmarks from public, anon;
grant select, insert, update, delete on public.lockd_market_price_benchmarks to authenticated;

-- The existing "LOCKD admins manage market benchmarks" policy in migration 0002
-- gates every authenticated operation using the server-managed app_metadata role.
