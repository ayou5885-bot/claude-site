-- Data retention, matching the privacy notice (12 months for enquiries that did not lead to work).
-- Run this once, then schedule it. pg_cron is available on Supabase (Database -> Extensions).

create or replace function public.purge_old_enquiries(p_months integer default 12)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_months is null or p_months < 1 then
    raise exception 'invalid_retention' using errcode = '22023';
  end if;

  delete from public.enquiries
   where created_at < now() - make_interval(months => p_months)
     and status in ('new', 'lost', 'spam');
  get diagnostics v_deleted = row_count;

  delete from public.enquiry_rate_limits where created_at < now() - interval '1 day';
  return v_deleted;
end;
$$;

revoke all on function public.purge_old_enquiries(integer) from public, anon, authenticated;
grant execute on function public.purge_old_enquiries(integer) to service_role;

-- Optional schedule (uncomment after enabling the pg_cron extension): every day at 03:15 UTC.
-- select cron.schedule('purge-old-enquiries', '15 3 * * *', $$ select public.purge_old_enquiries(12) $$);
