# FairBill feature rollout

| Checkpoint | Status | Dependency or safety gate |
| --- | --- | --- |
| India assistance policy lookup | Implemented on the feature branch | Check both registered hospital pages from the deployed server and verify the Android sheet before release. Expand the catalog by campus and source after review. |
| Revocable report links | Implemented on the feature branch | Local API, PostgreSQL grants and deletion, and Chromium download/revocation passed. Apply the migration on isolated staging and verify the existing Android app before enabling the server flag. |
| Approved follow-ups and outcomes | Implemented on the feature branch | Patient-owned due dates, status changes, reference numbers and confirmed outcomes. Stage and test in the Android app. Live delivery remains gated separately. |
| Guest and device-only review | Not shipped | Define local storage, deletion, offline checks, and an explicit migration into a signed-in account. Prevent cross-account mixing and duplicate cases. |
| Web patient experience | Not shipped | Build on the same authenticated case contract and verify upload, evidence, export, accessibility and session expiry in browsers. |
| Live advocate | Partial | Keep isolated opt-in previews and sandbox destinations until sender identity, caller identity, providers, configuration, consent, and operational safeguards are approved. |
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
