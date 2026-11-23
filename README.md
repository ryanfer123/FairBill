# FairBill

FairBill helps patients trace hospital charges and insurance deductions to the records that support them. Team Honey Potato built this India-first Android prototype for the AgenticX Agentic AI track. The demo uses fictional documents and simulated outreach.

## Run the Android demo

You need the APK in `artifacts/FairBill-Android.apk`, an Android arm64 phone or emulator, and a laptop running the local API. First-time setup needs internet, Python 3.13, and `uv`. Install Tesseract with English data for photo OCR.

```sh
./scripts/run-demo.sh
```

Connect the phone with USB debugging enabled, then run these commands in another terminal from this directory. Once dependencies are installed, the bundled investigation, OCR, simulated outreach, and PDF export work without venue internet.

```sh
adb install -r artifacts/FairBill-Android.apk
adb reverse tcp:8765 tcp:8765
```

With Wi-Fi instead of USB, run `FAIRBILL_BIND=0.0.0.0 ./scripts/run-demo.sh` on a trusted private network and enter the laptop’s private address and port in the app’s connection settings. Use synthetic material on both connections. The APK is signed for local testing.

## Walk through the case

1. Open the sample case and run the investigation. The ₹1,56,800 invoice becomes **₹1,55,400 conditional**. Open the two billing questions to inspect their evidence.
2. Add the second lab order and confirm the extracted row. Run the investigation again. The duplicate question is withdrawn and the total becomes **₹1,56,300 conditional**. The ₹500 quantity question stays active. The ₹12,000 insurance deduction remains separate.
3. Open Timeline to compare both revisions. Draft and approve the clarification letter, then simulate sending it. In the call simulation, verify your identity before continuing the advocate’s turn.
4. Preview and share the redacted PDF. To demonstrate capture, print the [one-page scan sample](demo/scan-invoice.pdf), create a new case, and take a photo. To demonstrate multi-page import, choose the [full synthetic invoice](demo/invoice.pdf) in a separate case.

The [demo folder](demo/) contains editable-in-app source fixtures as printable PDFs. The app extracts all PDF or photo text locally and recognises the labelled rows used in the fixtures. For other layouts, view extracted text and enter the rows manually. The sample policy is fictional. A policy citation shows a link in the submitted records and still needs applicability review.

## Build and test

Set `ANDROID_HOME` to your SDK, install NDK 27.2.12479018, and use Java 17. The build needs Node 22.13+ and installs the Expo packages from the lockfile.

```sh
./scripts/build-android.sh
(cd mobile && npm run typecheck)
(cd server && .venv/bin/pytest -q)
```

The optional Gemini path reads `GEMINI_API_KEY` and `FAIRBILL_GEMINI_MODEL` from the local server environment. It receives a small set of structured facts about the unedited bundled case. Offline mode runs the same checks and uses a fixed draft template. The app labels the mode in use. The backend computes figures in integer paise and holds the authoritative case revision, drafts, approvals, and simulated receipts. Local case data is in `.local/fairbill.sqlite3`.

Workflow inspiration from [BetterBill](https://github.com/matmanna/betterbill). FairBill's interface, implementation, synthetic documents, and test results are separate.
