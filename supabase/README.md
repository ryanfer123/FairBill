# FairBill Supabase

The dedicated FairBill project in Mumbai (`ap-south-1`) has the case schema, hosted workflow and a private `fairbill-originals` bucket. The baseline migrations are tracked in `migrations/` and were applied to project `ehqolzlwsjvnwiervyid`. The report-link migration remains a feature-branch change until it is verified and approved separately.

Authenticated users with an active session can read their own cases and originals. The server manages case writes, revisions and replay records. It reserves an object name before uploading on the user's behalf. The private bucket accepts PDF, JPEG, PNG and plain text up to 10 MiB.

Run the scripts in `tests/` as the project's database administrator. They verify case isolation, bucket configuration, revision and replay behavior, account deletion, and 30-day expiry using synthetic rows in rollback transactions.

Cases expire 30 days after creation. `ops/schedule_retention.sql` schedules the `fairbill-retention` Edge Function hourly. The scheduler authenticates using a purpose-limited token in Vault. The function removes aged database records and uses the Storage API to remove queued originals. Failed file removals remain queued for the next run.

Keep verified email sign-in enabled. Once custom SMTP is configured, set both **Confirm sign up** and **Magic link or OTP** to the subject `Your FairBill verification code` and use [the code-only template](templates/email-code.html) for both bodies. The user types the code in the app or on the web account-deletion page. Email scanners cannot use a code by following a link. For users outside the project team, Supabase requires a custom sender. See [Supabase's SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

For the Gmail test sender, use `smtp.gmail.com` on port `587`, the sender's Gmail address as both sender email and username, and a Google App Password saved directly in the Supabase SMTP dashboard. Use `FairBill` as the sender name. Google requires [2-Step Verification for App Passwords](https://support.google.com/mail/answer/185833).

For older messages with links, the allowed redirects are `fairbill://signin` and `https://fairbill-api.onrender.com/delete-account`. Supabase's default email includes a single-use link. A preview or security scan can use that link before the recipient opens it.

See the [hosted app runbook](../docs/hosted-app.md) for service environment, Android builds and deployment checks.
