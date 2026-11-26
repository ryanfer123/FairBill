# FairBill patient-flow verification

## Builds and targets

- Feature source `013cba3b21612fbdd487989a8bb57109fc403f7f` on `fairbill/parity`, followed by rupee label fix `9aebbd0c87d7d3330384aedbdeeb01c2c5876b44`.
- Android 37 isolated emulator, `dev.honeypotato.fairbill`. The test APK uses the feature bundle and a loopback service with fictional accounts. APK SHA-256 `711b7bd31533533b68e67430340209497af2c5125c24c7a1d5d2ce056d61406d`. This APK is for the emulator.
- Samsung SM-S942B. Gradle assembled a native hosted release at `013cba3`. The APK uses `dev.honeypotato.fairbill`, the same signing certificate and hosted HTTPS API, no cleartext support and no added permissions. SHA-256 `70d8a54c7837e1254224fe8a965d8f05e6d03d11d41ca5ab9c4cf445e9906b32` was verified after an in-place install. FairBill opened to the signed-in interface. The rupee fix was rebuilt and also installed in place. Its APK SHA-256 `0b5c868eaf4bd47f26decbf037cf441441f4f8622267e219989577f0836fcf7d` and returning session were verified after install. The emulator and local test services were closed. No patient case was opened.
- iOS. CoreSimulatorService disconnected during runtime discovery. No simulator or iPhone build was exercised.
- Live API. A read-only /v1/health request returned hosted, healthy, no demo and advertised `india-review` only.

## Mobile matrix

| Workflow | Isolated Android | Samsung | Evidence or remaining check |
| --- | --- | --- | --- |
| Cold launch and returning user | PASS, cold launch | PASS, launch after in-place update | The latest emulator test APK launched the sign-in screen. The verified native Samsung APK opened into the existing signed-in session. |
| OTP, expiry and account separation | BLOCKED | NOT RUN | The app accepted the fictional email and rejected an invalid code. Android Back and intermittent UiAutomation failures interrupted the remaining run. Verify a successful code, signed-in restart, expiry and a second account. |
| Camera permissions, scanner and document intake | NOT RUN | PASS, upload and paste navigation | The Samsung opened both sheets and cancelled each with Android Back on both hosted APKs. No file picker or submission. Permission denial, photo/PDF upload, extraction, discard, retry and confirmation still require a test account and fictional bill. A physical paper scan remains separate. |
| Cases reopen, filters and pagination | NOT RUN | NOT RUN | Logic regressions passed for refresh retry, next page retry and stale response suppression. Run the UI with 21+ fictional cases. |
| Archive, restore, delete and cancel | NOT RUN | NOT RUN | Check the exact case in the dialog and keep/cancel paths using fictional cases. |
| Assistant, evidence, policy and revision | NOT RUN | NOT RUN | Backend tests cover official policy success, unavailable, stale and unsupported, evidence revisions and consent. Check the patient UI through a supporting document and review refresh. |
| Redacted packet, PDF viewer, save, share and report link | NOT RUN | NOT RUN | Browser proved redacted PDF download and revocation from a fictional case. Verify local open/save, share cancellation and link lifetime on mobile. |
| Follow-ups, approval and guest transfer | NOT RUN | PASS, on-device ledger only | The Samsung saved and reopened a fictional ₹450.20 charge and cleared the local ledger. The visual check found an incorrect glyph in the two amount labels. The rebuilt APK displayed ₹ in both labels and the empty total. Backend tests cover ownership, idempotency and stale/revoked consent. Transfer, follow-ups and outreach authorisation still require hosted staging. |
| Appearance and interaction | PASS, dark sign-in only | PASS, appearance switching and Back | On the new APK, switched through Dark, Light and System, checked a black background pixel in Dark, restored the original preference, and returned to Settings with Android Back. Verify large fonts, reduced motion, TalkBack and poor-connection recovery separately. |

## Independent verification

- 128 backend tests, eight mobile logic/config tests and TypeScript passed. The hosted Android bundle exported with production configuration guards. Report-link grants, private storage and deletion cascades were tested in an isolated PostgreSQL runtime.
- Chromium at a 390 px viewport exercised fictional typed-code rejection/acceptance, itemised PDF intake, row edits, confirmation, evidence with ₹, redacted PDF download, session expiry and account separation through the web patient entry. A separate Chromium recipient test verified explicit PDF download and loss of access after revocation.
- The policy test found official excerpts for the two registered hospitals. Report links and the web portal remain disabled by default. Stage the migration and verify approved test-account auth and policy reachability before enabling hosted gates. Provider delivery and payments require separate approval and configuration.
