-- Enquiry storage with database-enforced rate limiting.
-- Security model: the browser NEVER talks to this database. Only the server-side API route,
-- holding the service-role key, can call submit_enquiry(). RLS is enabled with no policies
-- (deny by default) and every privilege is revoked from the public-facing roles.

create table public.enquiries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 80),
  email       text not null check (char_length(email) between 5 and 254),
  phone       text not null check (phone ~ '^\+?[0-9]{7,15}$'),
  postcode    text check (postcode is null or char_length(postcode) between 2 and 10),
  service     text not null check (char_length(service) between 1 and 60),
  message     text not null check (char_length(message) between 10 and 2000),
  status      text not null default 'new'
              check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  ip_hash     text not null check (char_length(ip_hash) = 64)
);

create index enquiries_created_at_idx on public.enquiries (created_at desc);

create table public.enquiry_rate_limits (
  ip_hash     text not null check (char_length(ip_hash) = 64),
  created_at  timestamptz not null default now()
);

create index enquiry_rate_limits_lookup_idx on public.enquiry_rate_limits (ip_hash, created_at);

alter table public.enquiries enable row level security;
alter table public.enquiry_rate_limits enable row level security;

revoke all on public.enquiries from public, anon, authenticated;
revoke all on public.enquiry_rate_limits from public, anon, authenticated;

-- The only entry point. SECURITY DEFINER with a pinned search_path, strict argument checks,
-- and the rate-limit check + insert in one transaction.
create or replace function public.submit_enquiry(p_payload jsonb, p_ip_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_recent integer;
  v_global integer;
begin
  if p_ip_hash is null
     or char_length(p_ip_hash) <> 64
     or p_payload is null
     or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- Serialise concurrent calls from the same visitor so the limit below cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));

  -- Per-visitor limit: 5 enquiries per 10 minutes.
  select count(*) into v_recent
    from public.enquiry_rate_limits
   where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Flood guard across all visitors: 300 per hour. Trade-off: a determined attacker with many
  -- addresses could use this up; pair with Turnstile (see SECURITY.md) if that is a concern.
  select count(*) into v_global
    from public.enquiries
   where created_at > now() - interval '1 hour';
  if v_global >= 300 then
    raise exception 'busy' using errcode = 'P0001';
  end if;

  insert into public.enquiry_rate_limits (ip_hash) values (p_ip_hash);
  delete from public.enquiry_rate_limits where created_at < now() - interval '1 day';

  insert into public.enquiries (name, email, phone, postcode, service, message, ip_hash)
  values (
    p_payload ->> 'name',
    p_payload ->> 'email',
    p_payload ->> 'phone',
    nullif(p_payload ->> 'postcode', ''),
    p_payload ->> 'service',
    p_payload ->> 'message',
    p_ip_hash
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_enquiry(jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry(jsonb, text) to service_role;
