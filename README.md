# FairBill

FairBill helps patients in India understand an itemised hospital bill and prepare questions for the billing team. It links each finding to evidence instead of guessing what the patient owes.

Built by **Team Honey Potato** for AgenticX. The tested client is a standalone Android app backed by a hosted FastAPI service. [Build Android](#build-android) · [Run locally](#run-locally) · [Tests](#tests) · [Privacy](https://fairbill-api.onrender.com/privacy)

## Patient workflow

1. **Add the bill.** Scan a photo, upload a PDF or image, or paste itemised text. Add supporting documents such as a lab order or insurer settlement.
2. **Confirm what was read.** Check charges against the source lines. Correct extraction errors and mark services you did not receive before running the review.
3. **Review billing questions.** FairBill checks for repeated charges, quantity and arithmetic issues, and differences against an insurer's settlement. The case assistant suggests the next step based on the confirmed records. When new evidence explains a charge, rerunning the review can withdraw that question while preserving prior revisions in the timeline.
4. **Decide what to share.** Approve the exact letter or call script before opening your email app or dialer. Preview, open, save, or share the redacted evidence PDF. FairBill does not send email or call a provider on its own.

Amounts are calculated in integer paise. A flagged amount is a question, not a confirmed overcharge or savings. The conditional invoice assumes the billing team accepts the included questions; insurance deductions are shown separately. [India pilot sources](docs/india-pilot-sources.md) cover selected tariffs, policy clauses, and assistance guidance, not nationwide coverage or eligibility decisions.

**Appearance:** Open **Settings → Appearance** for System, Light, or true-black Dark. The choice is saved on the device.

## Build Android

Prerequisites: Node.js 22.13+, Java 17, the Android SDK with NDK `27.2.12479018`, and `adb` if installing over USB. Set `ANDROID_HOME` to the SDK path.

```sh
git clone https://github.com/ryanfer123/FairBill.git
cd FairBill
export FAIRBILL_SUPABASE_PUBLISHABLE_KEY='your-project-publishable-key'
./scripts/build-android.sh
adb install -r artifacts/FairBill-Android.apk
```

The default APK targets ARM64 and uses the hosted HTTPS backend and email verification. Set `FAIRBILL_ANDROID_ABIS=x86_64` for an x86_64 emulator. Use only the Supabase **publishable** key in the client; the service key belongs on the server. See [hosted app setup](docs/hosted-app.md) for environment overrides and release requirements.

## Run locally

Install Python 3.13, [uv](https://docs.astral.sh/uv/), and Tesseract with English language data. In one terminal:

```sh
./scripts/run-demo.sh
```

In another terminal:

```sh
FAIRBILL_LOCAL_DEV=1 ./scripts/build-android.sh
adb install -r artifacts/FairBill-Android.apk
adb reverse tcp:8765 tcp:8765
```

The **local** build includes fictional documents and simulated outreach. Use it to try the evidence-revision workflow: a second lab order can resolve a duplicate-charge question while a separate quantity question remains open. The hosted patient build does not include the sample case or simulate communications. Don’t put real patient records into the local demo.

## Tests

From the repository root:

```sh
(cd server && uv sync --locked --python 3.13 && uv run pytest -q)
(cd mobile && npm ci --include=dev && npm run typecheck)
make eval
```

The [evaluation report](docs/eval-report.md) records performance on fictional bills. It does not establish OCR accuracy, coverage, or savings on real patient records.

## Repository guide

| Path | Contents |
| --- | --- |
| [mobile/](mobile/) | Expo and React Native client |
| [server/](server/) | FastAPI API, document extraction and billing checks, PDF export |
| [supabase/](supabase/) | Authentication, database migrations, and private storage |
| [demo/](demo/) | Fictional records for local use |
| [docs/](docs/) | [Architecture](docs/ARCHITECTURE.md), [API contract](docs/openapi.json), and setup |
| [scripts/](scripts/) | Build, local server, and API contract scripts |

[Hosted API health](https://fairbill-api.onrender.com/v1/health) · [Account deletion](https://fairbill-api.onrender.com/delete-account)

Workflow inspiration: [BetterBill](https://github.com/matmanna/betterbill).
