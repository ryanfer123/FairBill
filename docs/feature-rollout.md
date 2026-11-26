# FairBill feature rollout

| Checkpoint | Status | Dependency or safety gate |
| --- | --- | --- |
| India assistance policy lookup | Implemented on the feature branch | Check both registered hospital pages from the deployed server and verify the Android sheet before release. Expand the catalog by campus and source after review. |
| Revocable report links | Not shipped | Use explicit recipient consent and authenticated or high-entropy, case-scoped links. Keep documents in private storage. Test expiry, revocation, revision binding, and account deletion. Local redacted PDF export is available. |
| Approved follow-ups and outcomes | Partial | Patients can review wording and hand it to an email app or dialer. Add durable follow-up records, explicit approval for each action, and patient-confirmed outcomes. |
| Guest and device-only review | Not shipped | Define local storage, deletion, offline checks, and an explicit migration into a signed-in account. Prevent cross-account mixing and duplicate cases. |
| Web patient experience | Not shipped | Build on the same authenticated case contract and verify upload, evidence, export, accessibility and session expiry in browsers. |
| Live advocate | Partial | Keep isolated opt-in previews and sandbox destinations until sender identity, caller identity, providers, configuration, consent, and operational safeguards are approved. |
| Employer programme | Not shipped | Decide whether an employer receives aggregate reporting only. Explicitly define participant consent and access boundaries before a pilot. |
| Payments or success fees | Not shipped | Define what counts as verified savings, how consent and disputes work, and the financial obligations before choosing a payment provider. |
