create table public.fairbill_cases (
    id uuid primary key,
    owner_id uuid not null references auth.users(id) on delete cascade,
    serial bigint not null default 0 check (serial >= 0),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object')
);

create index fairbill_cases_owner_id_idx on public.fairbill_cases (owner_id, id);

create table public.fairbill_case_snapshots (
    case_id uuid not null references public.fairbill_cases(id) on delete cascade,
    serial bigint not null check (serial >= 0),
    reason text not null,
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    primary key (case_id, serial)
);

create table public.fairbill_request_replays (
    owner_id uuid not null references auth.users(id) on delete cascade,
    key text not null,
    fingerprint text not null,
    response jsonb not null check (jsonb_typeof(response) = 'object'),
    created_at timestamptz not null default now(),
    primary key (owner_id, key)
);

create index fairbill_request_replays_created_at_idx
    on public.fairbill_request_replays (created_at);

alter table public.fairbill_cases enable row level security;
alter table public.fairbill_case_snapshots enable row level security;
alter table public.fairbill_request_replays enable row level security;

revoke all on public.fairbill_cases, public.fairbill_case_snapshots,
    public.fairbill_request_replays from public, anon, authenticated;
grant select on public.fairbill_cases to authenticated;
grant select, insert, update, delete on public.fairbill_cases,
    public.fairbill_case_snapshots, public.fairbill_request_replays to service_role;

create policy fairbill_read_own_cases
    on public.fairbill_cases for select to authenticated
    using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fairbill-originals', 'fairbill-originals', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']);

-- The backend uses <user UUID>/<case UUID>/<document ID> for original files.
-- Keep writes server-side so uploads follow the case workflow and its file checks.
create policy fairbill_read_own_originals
    on storage.objects for select to authenticated
    using (
        bucket_id = 'fairbill-originals'
        and cardinality(storage.foldername(name)) = 2
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.fairbill_cases as c
            where c.owner_id = (select auth.uid())
              and c.id::text = (storage.foldername(storage.objects.name))[2]
        )
    );
