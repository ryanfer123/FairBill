begin;

insert into auth.users (id) values ('0bded4b2-d662-433b-938c-7e42fa299d10');
insert into public.fairbill_cases (id, owner_id, snapshot, created_at) values
    ('0bded4b2-d662-433b-938c-7e42fa299d11', '0bded4b2-d662-433b-938c-7e42fa299d10', '{}', now() - interval '31 days'),
    ('0bded4b2-d662-433b-938c-7e42fa299d12', '0bded4b2-d662-433b-938c-7e42fa299d10', '{}', now() - interval '29 days');
insert into public.fairbill_case_snapshots (case_id, serial, reason, snapshot)
    values ('0bded4b2-d662-433b-938c-7e42fa299d11', 0, 'test', '{}');
insert into public.fairbill_request_replays (owner_id, key, fingerprint, response)
    values ('0bded4b2-d662-433b-938c-7e42fa299d10', 'test', 'test', '{"id":"0bded4b2-d662-433b-938c-7e42fa299d11"}');

do $$
declare
    v_token text;
begin
    if public.fairbill_retention_batch('invalid') is not null then
        raise exception 'Invalid token reached retention batch';
    end if;
    select decrypted_secret into strict v_token from vault.decrypted_secrets where name = 'fairbill_retention_token';
    perform public.fairbill_retention_batch(v_token);
    if exists (select 1 from public.fairbill_cases where id = '0bded4b2-d662-433b-938c-7e42fa299d11')
       or exists (select 1 from public.fairbill_case_snapshots where case_id = '0bded4b2-d662-433b-938c-7e42fa299d11')
       or exists (select 1 from public.fairbill_request_replays where owner_id = '0bded4b2-d662-433b-938c-7e42fa299d10') then
        raise exception 'Expired case data was not removed';
    end if;
    if not exists (select 1 from public.fairbill_cases where id = '0bded4b2-d662-433b-938c-7e42fa299d12') then
        raise exception 'Case younger than 30 days was removed';
    end if;
end;
$$;

select 'FairBill 30-day retention passed' as result;
rollback;
