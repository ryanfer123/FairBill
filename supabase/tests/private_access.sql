-- Run on the dedicated FairBill project. No rows are retained.
begin;

insert into auth.users (id) values
    ('b6dc0e63-22f6-4448-81bd-453997b74111'),
    ('b6dc0e63-22f6-4448-81bd-453997b74112');

insert into auth.sessions (id, user_id) values
    ('b6dc0e63-22f6-4448-81bd-453997b74131', 'b6dc0e63-22f6-4448-81bd-453997b74111');

insert into public.fairbill_cases (id, owner_id, snapshot) values
    ('b6dc0e63-22f6-4448-81bd-453997b74121', 'b6dc0e63-22f6-4448-81bd-453997b74111', '{}'),
    ('b6dc0e63-22f6-4448-81bd-453997b74122', 'b6dc0e63-22f6-4448-81bd-453997b74112', '{}');

set local role anon;
do $$
begin
    if has_table_privilege(current_user, 'public.fairbill_cases', 'SELECT') then
        raise exception 'Anonymous role can read cases';
    end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b6dc0e63-22f6-4448-81bd-453997b74111', true);
select set_config('request.jwt.claims', '{"session_id":"b6dc0e63-22f6-4448-81bd-453997b74131"}', true);
do $$
begin
    if not exists (select 1 from public.fairbill_cases where id = 'b6dc0e63-22f6-4448-81bd-453997b74121')
       or exists (select 1 from public.fairbill_cases where id = 'b6dc0e63-22f6-4448-81bd-453997b74122') then
        raise exception 'Authenticated case isolation failed';
    end if;
    if has_table_privilege(current_user, 'public.fairbill_cases', 'INSERT, UPDATE, DELETE')
       or has_table_privilege(current_user, 'public.fairbill_case_snapshots', 'SELECT')
       or has_table_privilege(current_user, 'public.fairbill_request_replays', 'SELECT') then
        raise exception 'Authenticated role has server-only privileges';
    end if;
end;
$$;

reset role;
do $$
begin
    if not exists (
        select 1 from storage.buckets where id = 'fairbill-originals'
          and not public and file_size_limit = 10485760
    ) then
        raise exception 'Originals bucket is missing or incorrectly configured';
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'fairbill_read_own_originals' and cmd = 'SELECT'
          and roles = array['authenticated']::name[]
    ) then
        raise exception 'Owner-only object read policy is missing';
    end if;
end;
$$;

select 'FairBill case isolation and private bucket configuration passed' as result;
rollback;
