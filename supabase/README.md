# FairBill Supabase

The dedicated FairBill project in Mumbai (`ap-south-1`) has the case schema, hosted workflow and a private `fairbill-originals` bucket. The migrations are tracked in `migrations/` and were applied to project `ehqolzlwsjvnwiervyid`.

Authenticated users with an active session can read their own cases and originals. The server manages case writes, revisions and replay records. It reserves an object name before uploading on the user's behalf. The private bucket accepts PDF, JPEG, PNG and plain text up to 10 MiB.

Run the scripts in `tests/` as the project's database administrator. They verify case isolation, bucket configuration, revision and replay behavior, account deletion, and 30-day expiry using synthetic rows in rollback transactions.

Cases expire 30 days after creation. `ops/schedule_retention.sql` schedules the `fairbill-retention` Edge Function hourly. The scheduler authenticates using a purpose-limited token in Vault. The function removes aged database records and uses the Storage API to remove queued originals. Failed file removals remain queued for the next run.

Enable the email-code flow by setting the Auth email template for **Magic Link** to include `{{ .Token }}`. Keep verified email sign-in enabled. For users outside the project team, configure a custom SMTP sender. See [Supabase's SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

See the [hosted app runbook](../docs/hosted-app.md) for service environment, Android builds and deployment checks.
