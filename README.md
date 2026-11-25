# FairBill

FairBill helps patients trace hospital charges and insurance deductions to the records that support them. Team Honey Potato built this India-first Android prototype for the AgenticX Agentic AI track. The demo uses fictional documents and simulated outreach.

## Run FairBill on Android

Install the hosted APK on an Android arm64 phone or emulator, connect to the internet, and sign in with your email. FairBill connects to its HTTPS service automatically.

The sample case uses fictional bills and simulated outreach. The hosted app also supports uploading a bill to a signed-in account. Read [the privacy notice](https://fairbill-api.onrender.com/privacy) before uploading a bill.

## Local development

For a synthetic development build, install Python 3.13, `uv`, and Tesseract with English data. Start the test API with `./scripts/run-demo.sh`. Build with the explicit development flag and forward the fixed port over USB.

```sh
FAIRBILL_LOCAL_DEV=1 ./scripts/build-android.sh
adb install -r artifacts/FairBill-Android.apk
adb reverse tcp:8765 tcp:8765
```

## Walk through the case

1. Open the sample case and run the investigation. The ₹1,56,800 invoice becomes **₹1,55,400 conditional**. Open the two billing questions to inspect their evidence.
2. Add the second lab order and confirm the extracted row. Run the investigation again. The duplicate question is withdrawn and the total becomes **₹1,56,300 conditional**. The ₹500 quantity question stays active. The ₹12,000 insurance deduction remains separate.
3. Open Timeline to compare both revisions. Draft and approve the clarification letter, then simulate sending it. In the call simulation, verify your identity before continuing the advocate’s turn.
4. Preview and share the redacted PDF. To demonstrate capture, print the [one-page scan sample](demo/scan-invoice.pdf), create a new case, and take a photo. To demonstrate multi-page import, choose the [full synthetic invoice](demo/invoice.pdf) in a separate case.

The [demo folder](demo/) contains editable-in-app source fixtures as printable PDFs. The app extracts all PDF or photo text locally and recognises the labelled rows used in the fixtures. For other layouts, view extracted text and enter the rows manually. The sample policy is fictional. A policy citation shows a link in the submitted records and still needs applicability review.

## Build and test

Set `ANDROID_HOME` to your SDK, install NDK 27.2.12479018, and use Java 17. The build needs Node 22.13+ and installs the Expo packages from the lockfile. Export `FAIRBILL_SUPABASE_PUBLISHABLE_KEY` for the hosted build.

```sh
./scripts/build-android.sh
(cd mobile && npm run typecheck)
(cd server && .venv/bin/pytest -q)
```

The optional Gemini path reads `GEMINI_API_KEY` and `FAIRBILL_GEMINI_MODEL` from the local server environment. It receives a small set of structured facts about the unedited bundled case. The fixed-template path runs the same checks. The backend computes figures in integer paise and holds the authoritative case revision, drafts, approvals, and simulated receipts. Local case data is in `.local/fairbill.sqlite3`.

Workflow inspiration from [BetterBill](https://github.com/matmanna/betterbill). FairBill's interface, implementation, synthetic documents, and test results are separate.

## Versioned backend

The versioned API is served under `/v1`. Use `/v1/health` to check the active profile, database, planner mode and OCR. The hosted service stores cases under the signed-in account. The sample investigation uses bundled fixtures.

See the [backend architecture](docs/ARCHITECTURE.md), [V1 OpenAPI contract](docs/openapi.json), and [environment settings](.env.example). Use `make eval` to regenerate the synthetic evaluation. The hosted closed-test profile serves the bundled synthetic flow over a configured HTTPS endpoint.
