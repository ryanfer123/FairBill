-- Run in the dedicated hosted project after deploying fairbill-retention.
select cron.schedule('fairbill-case-retention', '7 * * * *', $$
    select net.http_post(
        url := 'https://ehqolzlwsjvnwiervyid.supabase.co/functions/v1/fairbill-retention',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-fairbill-retention',
            (select decrypted_secret from vault.decrypted_secrets where name = 'fairbill_retention_token')),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
    );
$$);
