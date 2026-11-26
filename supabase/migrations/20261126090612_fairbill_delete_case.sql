-- Serialize with case writes and Storage authorizations. Queue private originals
-- before cascading the case snapshots and reservations so cleanup can be retried.
create function public.fairbill_delete_case(p_owner uuid, p_case uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
    perform fairbill_private.lock_owner(p_owner);
    if not fairbill_private.is_active(p_owner) then return null; end if;
    if exists (select 1 from public.fairbill_cases where id = p_case and owner_id = p_owner) then
        insert into fairbill_private.expired_originals (case_id, owner_id)
            values (p_case, p_owner) on conflict do nothing;
        delete from public.fairbill_cases where id = p_case and owner_id = p_owner;
        delete from public.fairbill_request_replays
            where owner_id = p_owner and response->>'id' = p_case::text;
    end if;
    return coalesce((select jsonb_agg(o.name) from (
        select s.name from fairbill_private.expired_originals e join storage.objects s
          on s.bucket_id = 'fairbill-originals'
          and s.name like e.owner_id::text || '/' || e.case_id::text || '/%'
        where e.owner_id = p_owner and e.case_id = p_case
        order by s.name limit 100
    ) o), '[]'::jsonb);
end;
$$;
revoke all on function public.fairbill_delete_case(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fairbill_delete_case(uuid, uuid) to service_role;

-- Remove discarded source data from retained revisions as well as retry responses.
create function public.fairbill_purge_discarded_import(p_owner uuid, p_case uuid, p_document text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
    perform fairbill_private.lock_owner(p_owner);
    if p_document !~ '^[a-f0-9]{32}$' or not exists (
        select 1 from public.fairbill_cases where id = p_case and owner_id = p_owner
            and not (snapshot->'documents' @> jsonb_build_array(jsonb_build_object('id', p_document)))
    ) then return false; end if;
    update public.fairbill_case_snapshots s
        set snapshot = jsonb_set(s.snapshot, '{documents}', coalesce((
            select jsonb_agg(doc order by n) from jsonb_array_elements(s.snapshot->'documents') with ordinality d(doc,n)
            where doc->>'id' <> p_document
        ), '[]'::jsonb))
        where s.case_id = p_case and s.snapshot->'documents' @> jsonb_build_array(jsonb_build_object('id', p_document));
    delete from public.fairbill_request_replays
        where owner_id = p_owner and response->>'id' = p_case::text
          and response->'documents' @> jsonb_build_array(jsonb_build_object('id', p_document));
    return true;
end;
$$;
revoke all on function public.fairbill_purge_discarded_import(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fairbill_purge_discarded_import(uuid, uuid, text) to service_role;
