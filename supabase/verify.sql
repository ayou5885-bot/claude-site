-- Run in the Supabase SQL editor AFTER the migrations. Every check should return the expected value.

-- 1. RLS is on for both tables (expect: true, true)
select relname, relrowsecurity as rls_enabled
  from pg_class
 where relnamespace = 'public'::regnamespace and relname in ('enquiries', 'enquiry_rate_limits');

-- 2. No policies exist, so anon/authenticated are denied by default (expect: 0 rows)
select tablename, policyname from pg_policies where schemaname = 'public'
 and tablename in ('enquiries', 'enquiry_rate_limits');

-- 3. Public-facing roles hold NO privileges on the tables (expect: 0 rows)
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('enquiries', 'enquiry_rate_limits')
   and grantee in ('anon', 'authenticated', 'PUBLIC');

-- 4. Only service_role (and the owner) can execute the functions (expect: no anon/authenticated/PUBLIC rows)
select routine_name, grantee
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in ('submit_enquiry', 'purge_old_enquiries')
   and grantee in ('anon', 'authenticated', 'PUBLIC');

-- 5. Behavioural check as the anonymous role: both statements must fail with "permission denied"
--    (run them one at a time; the transaction is rolled back so nothing is changed)
begin;
  set local role anon;
  select * from public.enquiries;                                   -- expect: ERROR permission denied
rollback;

begin;
  set local role anon;
  select public.submit_enquiry('{}'::jsonb, repeat('a', 64));       -- expect: ERROR permission denied
rollback;

-- 6. Functional check as service_role: a valid call returns a uuid, and the 6th call within
--    10 minutes from the same hash raises "rate_limited". Clean up afterwards.
begin;
  set local role service_role;
  select public.submit_enquiry(
    '{"name":"Test User","email":"test@example.co.uk","phone":"02079460123","postcode":null,"service":"other","message":"Verification test message"}'::jsonb,
    repeat('b', 64));
rollback;
