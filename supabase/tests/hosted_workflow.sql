-- Run after the hosted workflow migration. This leaves no synthetic accounts or cases behind.
begin;

insert into auth.users (id) values
    ('5f14196a-d280-4666-a89e-5f78d77b1021'),
    ('5f14196a-d280-4666-a89e-5f78d77b1022');

insert into auth.sessions (id, user_id) values
    ('5f14196a-d280-4666-a89e-5f78d77b1025', '5f14196a-d280-4666-a89e-5f78d77b1021');

do $$
declare
    v_owner uuid := '5f14196a-d280-4666-a89e-5f78d77b1021';
    v_other uuid := '5f14196a-d280-4666-a89e-5f78d77b1022';
    v_case uuid := '5f14196a-d280-4666-a89e-5f78d77b1023';
    v_document text := '5f14196ad2804666a89e5f78d77b1024';
    v_session uuid := '5f14196a-d280-4666-a89e-5f78d77b1025';
    v_original text := v_owner::text || '/' || v_case::text || '/' || v_document;
    v_result jsonb;
begin
    if has_function_privilege('anon', 'public.fairbill_commit_case(uuid,uuid,bigint,text,text,text,jsonb,text)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.fairbill_account_originals_for_deletion(uuid)', 'EXECUTE') then
        raise exception 'Administrative RPC exposed to a client role';
    end if;

    v_result := public.fairbill_commit_case(v_owner, v_case, null, 'create', 'first', 'create', '{"revision": 1}', null);
    if v_result->>'status' <> 'ok' then raise exception 'Case creation failed'; end if;

    v_result := public.fairbill_commit_case(v_owner, v_case, null, 'create', 'first', 'create', '{"revision": 99}', null);
    if v_result->>'status' <> 'replay' or v_result->'snapshot'->>'revision' <> '1' then
        raise exception 'Case creation replay differs from original';
    end if;

    v_result := public.fairbill_commit_case(v_owner, v_case, null, 'create', 'different', 'create', '{}', null);
    if v_result->>'status' <> 'key_conflict' then raise exception 'Reused key accepted a new payload'; end if;

    v_result := public.fairbill_commit_case(v_other, v_case, 0, null, null, 'edit', '{}', null);
    if v_result->>'status' <> 'missing' then raise exception 'Cross-account write was not rejected'; end if;

    v_result := public.fairbill_commit_case(v_owner, v_case, 0, 'edit', 'second', 'edit', '{"revision": 2}', null);
    if v_result->>'status' <> 'ok' then raise exception 'Current revision update failed'; end if;
    v_result := public.fairbill_commit_case(v_owner, v_case, 0, null, null, 'edit', '{}', null);
    if v_result->>'status' <> 'case_conflict' then raise exception 'Stale revision update was not rejected'; end if;

    if not public.fairbill_reserve_original(v_owner, v_case, v_document) then raise exception 'Could not reserve upload'; end if;
    perform set_config('request.jwt.claim.sub', v_other::text, true);
    if fairbill_private.allow_reserved_original(v_original) then raise exception 'Other account can use a reservation'; end if;
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    if not fairbill_private.allow_reserved_original(v_original) then raise exception 'Owner cannot use valid reservation'; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('session_id', v_session)::text, true);
    if not fairbill_private.has_current_session() then raise exception 'Current session was denied'; end if;
    delete from auth.sessions where id = v_session;
    if fairbill_private.has_current_session() then raise exception 'Revoked session was still accepted'; end if;
    v_result := public.fairbill_commit_case(v_owner, v_case, 1, null, null, 'upload', '{}', v_original);
    if v_result->>'status' <> 'original_missing' then raise exception 'Committed an upload without the Storage object'; end if;

    perform public.fairbill_account_originals_for_deletion(v_owner);
    if fairbill_private.allow_reserved_original(v_original) then raise exception 'Upload authorized after deletion began'; end if;
    if (public.fairbill_hosted_state(v_owner, v_case, 'create'))->>'status' <> 'inactive' then
        raise exception 'Account available after deletion began';
    end if;
    if exists (select 1 from public.fairbill_cases where owner_id = v_owner)
       or exists (select 1 from public.fairbill_request_replays where owner_id = v_owner)
       or exists (select 1 from public.fairbill_case_snapshots where case_id = v_case) then
        raise exception 'Case, revisions or replay survived deletion';
    end if;
end;
$$;

select 'FairBill hosted ownership, retries, revisions and account deletion passed' as result;
rollback;
