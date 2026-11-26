# FairBill feature rollout

| Checkpoint | Status | Dependency or safety gate |
| --- | --- | --- |
| India assistance policy lookup | Implemented on the feature branch | Check both registered hospital pages from the deployed server and verify the Android sheet before release. Expand the catalog by campus and source after review. |
| Revocable report links | Implemented on the feature branch | Local API, PostgreSQL grants and deletion, and Chromium download/revocation passed. Apply the migration on isolated staging and verify the existing Android app before enabling the server flag. |
| Approved follow-ups and outcomes | Implemented on the feature branch | Patient-owned due dates, status changes, reference numbers and confirmed outcomes. Stage and test in the Android app. Live delivery remains gated separately. |
| Guest and device-only review | Implemented on the feature branch | Manual on-device ledger and total comparison. Account transfer needs explicit consent and binds retries to the selected account. Local storage and reopening passed on the Samsung. Verify explicit transfer with an isolated staging account. |
| Web patient experience | Implemented on the feature branch | Chromium passed an isolated typed-code session, small viewport, PDF upload, editing and confirmation, evidence, export, expiry and account separation. Verify with staged auth before enabling the portal. |
| Live advocate | Partial | Device handoff checks the exact approved wording and evidence revision. Patients can withdraw approval. Provider delivery awaits a provider, sender and caller identities, a consent process, and controlled test destinations. |
| Employer programme | Not shipped | Decide whether an employer receives aggregate reporting only. Explicitly define participant consent and access boundaries before a pilot. |
| Payments or success fees | Not shipped | Define what counts as verified savings, how consent and disputes work, and the financial obligations before choosing a payment provider. |


## Report sharing release gate

Sharing is disabled unless the API is explicitly started with `FAIRBILL_REPORT_SHARING=1`. The Android screen appears only when the hosted API advertises `report-links`. The existing local PDF export is available independently.

From a reviewed case, preview the redacted packet, choose an expiry, and agree to share that revision. Creating a link and opening the system share menu are separate actions. The owner can revoke access from the packet screen. An evidence revision change, case deletion, account deletion, expiry, or revocation ends new downloads. Recipients can retain any already-downloaded copy.

The server stores a SHA-256 hash of a random 256-bit token and pins a private case snapshot. The link fragment stays out of HTTP URLs. The landing page reveals no report data and only requests a download after the recipient presses its button. Both the landing and download use no-store and noindex headers. The API checks availability again after PDF rendering.

Reproduce the local verification with the backend test suite and the following isolated PostgreSQL test. The PostgreSQL harness uses temporary tools and synthetic account records.

```sh
npm install --prefix /tmp/fairbill-sql-test --no-audit --no-fund @electric-sql/pglite@0.6.0
FAIRBILL_SQL_TEST_TOOLS=/tmp/fairbill-sql-test node supabase/tests/report_links.mjs
```

Before enabling sharing, verify the migration and end-to-end flow on isolated Supabase staging. Verify the hosted feature flag and signing compatibility before updating the existing Android install.


## On-device ledger

The sign-in and Summary screens offer manual device-only review. Store up to 15 entered charges and an optional printed total in device secure storage. FairBill calculates totals in paise. The on-device flow does not scan files or call the assistance service. A signed-in patient can explicitly transfer those values when the API advertises `guest-adoption`.

A transfer is bound to its target account before upload. If the response is ambiguous, retry from the same account. The server returns the same private case for the same ledger. FairBill removes the local copy after receiving the saved case. The patient must review the imported lines against the original bill before confirming them.


## Web patient portal

The patient portal is disabled unless `FAIRBILL_WEB_PATIENT=1` is explicitly set on the hosted server. The portal uses the configured Supabase publishable credential to request typed email codes. Access tokens and case data stay in the browser page session, with no local or session storage writes. The portal clears the visible case and file selection when the service rejects an expired session.

Local Chromium verification used two fictional accounts behind an isolated auth fixture and generated itemised PDFs. The provider did not send any email. Verify code delivery and expiry in an authorized staging account before making the route available.


## Outreach approval and delivery

The hosted app validates the destination locally. On a backend that advertises `outreach-consent`, opening the device email app or dialer requires an explicit handoff tied to the current revision and approved draft hash. The patient can withdraw that approval before opening the external app. The case timeline records the patient's authorisation or withdrawal. The destination and delivery result stay out of that request, and the patient places the call or sends the letter from their own app.

Before connecting any delivery provider, approve sender and caller identities, test with controlled destinations, bind each approved action to the exact wording and verified recipient, and define cancellation, consent withdrawals, audit access and provider receipt handling. Obtain a separate decision on processing patient records with any external model or call provider.

## Pilot decisions

An employer pilot can start with a participation invitation and simulated aggregate reporting. Define opt-in consent, aggregation thresholds, suppression for small groups and retention before using real participation data. Keep cases, bills, contact details and individual outcomes private to patients.

A payment pilot requires a definition of verified savings and an independently checkable final bill or settlement, an explicit acceptance step, clear fees, and refund and dispute handling before any payment activation. Keep pricing and provider selection outside the patient flow until those decisions are made.


## What staging needs

Use a separate HTTPS API and Supabase project with private storage. Apply the migrations in `supabase/migrations` in order, including `20261126180000_fairbill_report_links.sql`. Verify the storage and database policies with two dedicated test accounts and fictional records. Configure the staging publishable key, a server-only service key, and typed-code auth for two approved test inboxes. Keep the Samsung’s existing install on production. Use the staging portal in a private browser session and an approved separate Android test target for staging mobile checks.

| Feature | Required staging setup | Acceptance check |
| --- | --- | --- |
| Policy lookup | Staging API advertises `policy-lookup` and can reach the registered official hospital pages. | From a fictional case, select a registered hospital and verify the excerpt against the original URL. Exercise an unavailable source and an unsupported hospital. |
| Revocable links | Apply the report-link migration and enable `FAIRBILL_REPORT_SHARING=1` on staging. | Create a link with consent for the current revision. Open the redacted PDF as the recipient, revoke the link, then separately verify expiry. The second account cannot manage the owner's links. |
| Follow-ups | Staging API advertises `follow-ups` and has a fictional reviewed case. | Save and reopen a due date, status, reference and patient-confirmed outcome. Retry without creating a duplicate. |
| Guest transfer | Staging API advertises `guest-adoption`. Use a fictional ledger and both test accounts. | Enter a charge locally, sign in and explicitly transfer. Verify the saved case, safe retry, removal of the local copy after success and account separation. |
| Web portal | Enable `FAIRBILL_WEB_PATIENT=1` on the staging API and configure typed-code auth. | Verify staged code delivery and expiry, PDF intake through confirmation, redacted export, returning to sign-in after expiry and separation between the accounts. |


### Local verification

With the server dependencies installed and `npm ci` run in `mobile`, run:

```sh
FAIRBILL_TEST_PYTHON=/path/to/venv/bin/python scripts/verify-fairbill-parity.sh
```

Set `FAIRBILL_SQL_TEST_TOOLS` to the temporary PGlite tools directory described above to include the migration, RLS, expiry and revocation checks. The command uses fictional inputs, local auth fixtures and temporary databases. The patient PDF test imports a fresh invoice, confirms it, adds a second service order, verifies that the duplicate question is withdrawn and the separate quantity question persists, then checks the exact draft approval and the redacted PDF.
