-- Capabilities live in a private table. Only the backend can resolve a hash.
create table fairbill_private.report_links (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null references public.fairbill_cases(id) on delete cascade,
    revision integer not null check (revision >= 1),
    serial bigint not null check (serial >= 0),
    token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
    creation_key text not null check (creation_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    unique (case_id, creation_key),
    foreign key (case_id, serial) references public.fairbill_case_snapshots(case_id, serial) on delete cascade
);
alter table fairbill_private.report_links enable row level security;
revoke all on fairbill_private.report_links from public, anon, authenticated, service_role;

create function fairbill_private.report_link_info(
    p_link fairbill_private.report_links, p_current_revision integer
) returns jsonb language sql volatile set search_path = '' as $$
    select jsonb_build_object(
        'id', p_link.id, 'revision', p_link.revision, 'expires_at', p_link.expires_at, 'revoked_at', p_link.revoked_at,
        'status', case when p_link.revoked_at is not null then 'revoked'
                       when p_link.expires_at <= clock_timestamp() then 'expired'
                       when p_link.revision <> p_current_revision then 'superseded'
                       else 'active' end
    );
$$;
revoke all on function fairbill_private.report_link_info(fairbill_private.report_links, integer)
    from public, anon, authenticated, service_role;

create function public.fairbill_create_report_link(
    p_owner uuid, p_case uuid, p_revision integer, p_hours integer, p_key text, p_hash text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_case public.fairbill_cases%rowtype;
    v_link fairbill_private.report_links%rowtype;
begin
    perform fairbill_private.lock_owner(p_owner);
    if not fairbill_private.is_active(p_owner) then return jsonb_build_object('status', 'inactive'); end if;
    select * into v_case from public.fairbill_cases where id = p_case and owner_id = p_owner;
    if not found then return jsonb_build_object('status', 'missing'); end if;
    if p_hours is null or p_hours not between 1 and 168 or p_revision is null or p_revision < 1
       or v_case.snapshot->>'sample' is distinct from 'false'
       or v_case.snapshot->>'revision' is distinct from p_revision::text
       or v_case.snapshot->>'investigated_revision' is distinct from p_revision::text then
        return jsonb_build_object('status', 'case_conflict');
    end if;
    if exists (select 1 from fairbill_private.report_links where case_id = p_case and creation_key = p_key) then
        return jsonb_build_object('status', 'key_conflict');
    end if;
    if (select count(*) from fairbill_private.report_links where case_id = p_case and revision = p_revision
        and revoked_at is null and expires_at > clock_timestamp()) >= 10 then
        return jsonb_build_object('status', 'limit');
    end if;
    insert into fairbill_private.report_links (case_id, revision, serial, token_hash, creation_key, expires_at)
        values (p_case, p_revision, v_case.serial, p_hash, p_key, clock_timestamp() + make_interval(hours => p_hours))
        returning * into v_link;
    return jsonb_build_object('status', 'ok', 'link', fairbill_private.report_link_info(v_link, p_revision));
end;
$$;

create function public.fairbill_list_report_links(p_owner uuid, p_case uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_revision integer;
    v_links jsonb;
begin
    perform fairbill_private.lock_owner(p_owner);
    if not fairbill_private.is_active(p_owner) then return jsonb_build_object('status', 'inactive'); end if;
    select (snapshot->>'revision')::integer into v_revision
        from public.fairbill_cases where id = p_case and owner_id = p_owner;
    if not found then return jsonb_build_object('status', 'missing'); end if;
    select jsonb_agg(info order by active desc, expires_at desc, id) into v_links
        from (
            select fairbill_private.report_link_info(link, v_revision) as info, link.id, link.expires_at,
                   (revision = v_revision and revoked_at is null and expires_at > clock_timestamp()) as active
              from fairbill_private.report_links link
             where case_id = p_case order by active desc, expires_at desc, id limit 50
        ) as visible_links;
    return jsonb_build_object('status', 'ok', 'links', coalesce(v_links, '[]'::jsonb));
end;
$$;

create function public.fairbill_revoke_report_link(p_owner uuid, p_case uuid, p_link uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
    perform fairbill_private.lock_owner(p_owner);
    if not fairbill_private.is_active(p_owner) then return false; end if;
    update fairbill_private.report_links
        set revoked_at = coalesce(revoked_at, clock_timestamp())
      where id = p_link and case_id = p_case
        and exists (select 1 from public.fairbill_cases where id = p_case and owner_id = p_owner);
    return found;
end;
$$;

create function public.fairbill_resolve_report_link(p_hash text, p_check_only boolean)
returns jsonb language sql volatile security definer set search_path = '' as $$
    select case when p_check_only then 'true'::jsonb else pinned.snapshot end
      from fairbill_private.report_links link
      join public.fairbill_cases current on current.id = link.case_id
      join public.fairbill_case_snapshots pinned on pinned.case_id = link.case_id and pinned.serial = link.serial
     where link.token_hash = p_hash and link.revoked_at is null and link.expires_at > clock_timestamp()
       and current.snapshot->>'revision' = link.revision::text
       and pinned.snapshot->>'revision' = link.revision::text
       and pinned.snapshot->>'investigated_revision' = link.revision::text
       and fairbill_private.is_active(current.owner_id);
$$;

revoke all on function public.fairbill_create_report_link(uuid, uuid, integer, integer, text, text),
    public.fairbill_list_report_links(uuid, uuid), public.fairbill_revoke_report_link(uuid, uuid, uuid),
    public.fairbill_resolve_report_link(text, boolean) from public, anon, authenticated;
grant execute on function public.fairbill_create_report_link(uuid, uuid, integer, integer, text, text),
    public.fairbill_list_report_links(uuid, uuid), public.fairbill_revoke_report_link(uuid, uuid, uuid),
    public.fairbill_resolve_report_link(text, boolean) to service_role;
