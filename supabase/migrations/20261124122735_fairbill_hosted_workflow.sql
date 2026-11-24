create schema if not exists fairbill_private;

create table fairbill_private.account_deletions (
    owner_id uuid primary key references auth.users(id) on delete cascade
);

create table fairbill_private.reserved_originals (
    object_name text primary key,
    owner_id uuid not null references auth.users(id) on delete cascade,
    case_id uuid not null references public.fairbill_cases(id) on delete cascade,
    expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index fairbill_reserved_originals_owner_idx on fairbill_private.reserved_originals (owner_id);
create index fairbill_reserved_originals_case_idx on fairbill_private.reserved_originals (case_id);

alter table fairbill_private.account_deletions enable row level security;
alter table fairbill_private.reserved_originals enable row level security;

create function fairbill_private.lock_owner(p_owner uuid)
returns void language sql volatile set search_path = '' as $$
    select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text, 247086));
$$;

create function fairbill_private.is_active(p_owner uuid)
returns boolean language sql stable set search_path = '' as $$
    select exists (select 1 from auth.users where id = p_owner)
       and not exists (select 1 from fairbill_private.account_deletions where owner_id = p_owner);
$$;

create function fairbill_private.allow_reserved_original(p_name text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
    v_owner uuid := auth.uid();
begin
    if v_owner is null then return false; end if;
    perform fairbill_private.lock_owner(v_owner);
    return fairbill_private.is_active(v_owner) and exists (
        select 1 from fairbill_private.reserved_originals
        where owner_id = v_owner and object_name = p_name and expires_at >= now()
    );
end;
$$;

revoke all on function fairbill_private.lock_owner(uuid), fairbill_private.is_active(uuid),
    fairbill_private.allow_reserved_original(text) from public, anon, authenticated;
grant execute on function fairbill_private.allow_reserved_original(text) to authenticated;

create policy fairbill_insert_reserved_original
    on storage.objects for insert to authenticated
    with check (case when bucket_id = 'fairbill-originals'
        then fairbill_private.allow_reserved_original(name) else false end);

create function public.fairbill_validate_session(p_owner uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from auth.sessions where id = p_session and user_id = p_owner
                   and (not_after is null or not_after >= now()));
$$;

create function public.fairbill_hosted_state(p_owner uuid, p_case uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    if not fairbill_private.is_active(p_owner) then
        return jsonb_build_object('status', 'inactive');
    end if;
    return jsonb_build_object(
        'status', 'ok',
        'replay', (select to_jsonb(r) from public.fairbill_request_replays r
            where owner_id = p_owner and key = p_key and created_at >= now() - interval '24 hours'),
        'current', (select to_jsonb(c) from public.fairbill_cases c where owner_id = p_owner and id = p_case)
    );
end;
$$;

create function public.fairbill_reserve_original(p_owner uuid, p_case uuid, p_document text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
    perform fairbill_private.lock_owner(p_owner);
    if not fairbill_private.is_active(p_owner)
       or not exists (select 1 from public.fairbill_cases where id = p_case and owner_id = p_owner)
       or p_document !~ '^[a-f0-9]{32}$' then return false; end if;
    insert into fairbill_private.reserved_originals (object_name, owner_id, case_id)
        values (p_owner::text || '/' || p_case::text || '/' || p_document, p_owner, p_case);
    return true;
end;
$$;

create function public.fairbill_cancel_original(p_owner uuid, p_object text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
    perform fairbill_private.lock_owner(p_owner);
    delete from fairbill_private.reserved_originals where owner_id = p_owner and object_name = p_object;
    return found;
end;
$$;

create function public.fairbill_commit_case(
    p_owner uuid, p_case uuid, p_expected bigint, p_key text, p_fingerprint text,
    p_reason text, p_snapshot jsonb, p_original text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_replay public.fairbill_request_replays%rowtype;
    v_current public.fairbill_cases%rowtype;
    v_serial bigint := 0;
begin
    perform fairbill_private.lock_owner(p_owner);
    if not fairbill_private.is_active(p_owner) then return jsonb_build_object('status', 'inactive'); end if;

    if p_key is not null then
        select * into v_replay from public.fairbill_request_replays
            where owner_id = p_owner and key = p_key and created_at >= now() - interval '24 hours';
        if found then
            if v_replay.fingerprint <> p_fingerprint then
                return jsonb_build_object('status', 'key_conflict');
            end if;
            return jsonb_build_object('status', 'replay', 'snapshot', v_replay.response);
        end if;
    end if;

    if p_original is not null then
        if not exists (select 1 from fairbill_private.reserved_originals r where r.owner_id = p_owner
                       and r.case_id = p_case and r.object_name = p_original)
           or not exists (select 1 from storage.objects where bucket_id = 'fairbill-originals' and name = p_original) then
            return jsonb_build_object('status', 'original_missing');
        end if;
    end if;

    if p_expected is null then
        insert into public.fairbill_cases (id, owner_id, serial, snapshot) values (p_case, p_owner, 0, p_snapshot);
    else
        select * into v_current from public.fairbill_cases where id = p_case and owner_id = p_owner;
        if not found then return jsonb_build_object('status', 'missing'); end if;
        if v_current.serial <> p_expected then return jsonb_build_object('status', 'case_conflict'); end if;
        insert into public.fairbill_case_snapshots (case_id, serial, reason, snapshot)
            values (p_case, v_current.serial, 'source_state', v_current.snapshot) on conflict do nothing;
        v_serial := v_current.serial + 1;
        update public.fairbill_cases set serial = v_serial, snapshot = p_snapshot where id = p_case;
    end if;

    insert into public.fairbill_case_snapshots (case_id, serial, reason, snapshot)
        values (p_case, v_serial, p_reason, p_snapshot);

    if p_key is not null then
        delete from public.fairbill_request_replays where owner_id = p_owner and created_at < now() - interval '24 hours';
        insert into public.fairbill_request_replays (owner_id, key, fingerprint, response)
            values (p_owner, p_key, p_fingerprint, p_snapshot);
    end if;
    if p_original is not null then
        delete from fairbill_private.reserved_originals where object_name = p_original;
    end if;
    return jsonb_build_object('status', 'ok', 'snapshot', p_snapshot);
end;
$$;

create function public.fairbill_account_originals_for_deletion(p_owner uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
    perform fairbill_private.lock_owner(p_owner);
    if exists (select 1 from auth.users where id = p_owner) then
        insert into fairbill_private.account_deletions values (p_owner) on conflict do nothing;
        delete from public.fairbill_cases where owner_id = p_owner;
        delete from public.fairbill_request_replays where owner_id = p_owner;
    end if;
    return coalesce((select jsonb_agg(name order by name) from (
        select name from storage.objects
        where bucket_id = 'fairbill-originals' and name like p_owner::text || '/%'
        order by name limit 100
    ) objects), '[]'::jsonb);
end;
$$;

revoke all on function public.fairbill_validate_session(uuid, uuid), public.fairbill_hosted_state(uuid, uuid, text),
    public.fairbill_reserve_original(uuid, uuid, text),
    public.fairbill_cancel_original(uuid, text),
    public.fairbill_commit_case(uuid, uuid, bigint, text, text, text, jsonb, text),
    public.fairbill_account_originals_for_deletion(uuid) from public, anon, authenticated;
grant execute on function public.fairbill_validate_session(uuid, uuid), public.fairbill_hosted_state(uuid, uuid, text),
    public.fairbill_reserve_original(uuid, uuid, text),
    public.fairbill_cancel_original(uuid, text),
    public.fairbill_commit_case(uuid, uuid, bigint, text, text, text, jsonb, text),
    public.fairbill_account_originals_for_deletion(uuid) to service_role;
