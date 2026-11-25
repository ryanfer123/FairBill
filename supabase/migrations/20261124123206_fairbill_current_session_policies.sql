-- Direct Data and Storage API reads must reject revoked sessions as FastAPI does.
create function fairbill_private.has_current_session()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
    v_session text := auth.jwt()->>'session_id';
begin
    if v_session is null or v_session !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'false' then
        return false;
    end if;
    return public.fairbill_validate_session(auth.uid(), v_session::uuid);
end;
$$;

revoke all on function fairbill_private.has_current_session() from public, anon, authenticated;
grant execute on function fairbill_private.has_current_session() to authenticated;

alter policy fairbill_read_own_cases on public.fairbill_cases
    using (owner_id = (select auth.uid()) and (select fairbill_private.has_current_session()));

alter policy fairbill_read_own_originals on storage.objects
    using (
        bucket_id = 'fairbill-originals'
        and (select fairbill_private.has_current_session())
        and cardinality(storage.foldername(name)) = 2
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (
            select 1 from public.fairbill_cases as c
            where c.owner_id = (select auth.uid())
              and c.id::text = (storage.foldername(storage.objects.name))[2]
        )
    );

alter policy fairbill_insert_reserved_original on storage.objects
    with check (case when bucket_id = 'fairbill-originals' and (select fairbill_private.has_current_session())
        then fairbill_private.allow_reserved_original(name) else false end);
