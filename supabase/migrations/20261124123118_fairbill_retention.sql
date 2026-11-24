alter table public.fairbill_cases add column created_at timestamptz not null default now();
create index fairbill_cases_created_at_idx on public.fairbill_cases (created_at, id);

create table fairbill_private.expired_originals (
    case_id uuid primary key,
    owner_id uuid not null,
    queued_at timestamptz not null default now()
);
alter table fairbill_private.expired_originals enable row level security;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- This token authorizes retention only. Generate it within Vault.
do $$
begin
    if not exists (select 1 from vault.decrypted_secrets where name = 'fairbill_retention_token') then
        perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
            'fairbill_retention_token');
    end if;
end;
$$;

create function public.fairbill_retention_batch(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_case record;
begin
    if not exists (select 1 from vault.decrypted_secrets
        where name = 'fairbill_retention_token' and decrypted_secret = p_token) then
        return null;
    end if;

    -- Prevent concurrent runs from locking a series of owners in different orders.
    if not pg_catalog.pg_try_advisory_xact_lock(43154518, 1) then return '[]'::jsonb; end if;
    for v_case in
        select id, owner_id from public.fairbill_cases
        where created_at <= now() - interval '30 days'
        order by created_at, id limit 100
    loop
        perform fairbill_private.lock_owner(v_case.owner_id);
        insert into fairbill_private.expired_originals (case_id, owner_id)
            values (v_case.id, v_case.owner_id) on conflict do nothing;
        delete from public.fairbill_cases where id = v_case.id;
        delete from public.fairbill_request_replays
            where owner_id = v_case.owner_id and response->>'id' = v_case.id::text;
    end loop;

    delete from public.fairbill_request_replays where created_at < now() - interval '24 hours';

    -- Read metadata only. The Edge Function deletes files through the Storage API.
    delete from fairbill_private.expired_originals e where not exists (
        select 1 from storage.objects where bucket_id = 'fairbill-originals'
          and name like e.owner_id::text || '/' || e.case_id::text || '/%'
    );
    return coalesce((select jsonb_agg(o.name) from (
        select s.name from fairbill_private.expired_originals e join storage.objects s
          on s.bucket_id = 'fairbill-originals' and s.name like e.owner_id::text || '/' || e.case_id::text || '/%'
        order by e.queued_at, s.name limit 100
    ) o), '[]'::jsonb);
end;
$$;

revoke all on function public.fairbill_retention_batch(text) from public, anon, authenticated;
grant execute on function public.fairbill_retention_batch(text) to service_role;

