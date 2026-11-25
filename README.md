# FairBill

FairBill helps patients check Indian hospital bills against their own records. It turns repeated charges, quantity mismatches, and insurance deductions into questions for the billing team, with links to the relevant document lines.

Built by **Team Honey Potato** for the AgenticX hackathon. The project includes a standalone Android app, a FastAPI service, and a separate fictional demo.

[Build for Android](#build-for-android) · [Walk through the sample](#walk-through-the-sample) · [Explore the repository](#repository-guide) · [Tests and evaluation](#tests-and-evaluation)

## How it works

1. **Add a bill.** Scan a photo, upload a PDF, or paste text. Add supporting records or an insurance settlement when available.
2. **Confirm the lines.** Compare extracted text with your records, correct misreads, and mark services you did not receive.
3. **Review the questions.** Deterministic rules calculate in integer paise. Each finding links to its source. The conditional total assumes billing agrees with the included questions, and insurance deductions are shown separately.
4. **Decide what to share.** Review the exact letter or call script before handing it off to your email app or dialer. Preview the redacted PDF before sharing it.

The hosted India pilot covers selected [tariff and policy sources](docs/india-pilot-sources.md) where the hospital, date, and policy details match. Published rates and policy wording can support a question. Coverage and assistance decisions remain with the insurer or hospital.

## Build for Android

Install Node.js 22.13 or later, Java 17, and the Android SDK with NDK `27.2.12479018`. Set `ANDROID_HOME` to your SDK path. Add `adb` from Android Platform Tools to your path if you plan to install over USB.

```sh
git clone https://github.com/ryanfer123/FairBill.git
cd FairBill

export FAIRBILL_SUPABASE_PUBLISHABLE_KEY='your-project-publishable-key'
./scripts/build-android.sh
adb install -r artifacts/FairBill-Android.apk
```

The script builds an ARM64 APK by default. For an x86_64 emulator, set `FAIRBILL_ANDROID_ABIS=x86_64` when running the build script. The installed hosted app uses HTTPS and email verification. It needs internet access and works independently of the development machine. The mobile build uses the Supabase publishable key. Keep the service key on the server.

- [Hosted setup and deployment](docs/hosted-app.md)
- [Privacy notice](https://fairbill-api.onrender.com/privacy)
- [Account deletion](https://fairbill-api.onrender.com/delete-account)

## Walk through the sample

The fictional sample and simulated outreach run in the **development or fixture build**. To run the local development version, install Python 3.13, `uv`, and Tesseract with English data.

Start the demo API in one terminal:

```sh
./scripts/run-demo.sh
```

Build and install from a second terminal:

```sh
FAIRBILL_LOCAL_DEV=1 ./scripts/build-android.sh
adb install -r artifacts/FairBill-Android.apk
adb reverse tcp:8765 tcp:8765
```

| Step | What the sample shows |
| --- | --- |
| Run the first review | The billed amount is **₹1,56,800**. A ₹900 duplicate question and a ₹500 quantity question yield a **₹1,55,400 conditional total**. |
| Add and confirm the second lab order, then rerun | The order explains the repeated charge. FairBill withdraws the ₹900 question and shows **₹1,56,300 conditional**. The ₹500 question remains. |
| Open Timeline and review the insurance deduction | Both revisions remain available. The **₹12,000 insurance deduction** stays separate from the invoice calculation. |
| Open Act | Approve the exact letter, simulate outreach, and confirm identity before the simulated advocate can speak. Preview the redacted PDF. |

To try import in a separate local case, use the [printable scan sample](demo/scan-invoice.pdf) or [multi-page fictional invoice](demo/invoice.pdf). Check extraction against the original before confirming. Other invoice layouts may require manual line entry.

## Repository guide

| Path | Contents |
| --- | --- |
| [`mobile/`](mobile/) | Expo and React Native Android app with Material controls |
| [`server/`](server/) | FastAPI `/v1` API, PDF and photo extraction, billing rules, and redacted PDF generation |
| [`supabase/`](supabase/) | Authentication, case storage, private uploads, and database migrations |
| [`demo/`](demo/) | Fictional bill, settlement, policy, and service records |
| [`design/fairbill/`](design/fairbill/) | Design exploration and previews |
| [`scripts/`](scripts/) | Android build, local server startup, and contract export |

See the [local backend architecture](docs/ARCHITECTURE.md), [OpenAPI contract](docs/openapi.json), and [environment settings](.env.example). The API reports database and OCR readiness at `/v1/health`.

## Tests and evaluation

Run these from the repository root:

```sh
(cd server && uv sync --locked --python 3.13)
(cd server && .venv/bin/python -m pytest -q)
(cd mobile && npm ci --include=dev && npm run typecheck)
make eval
```

The [synthetic evaluation](docs/eval-report.md) reports seeded findings, clean-bill checks, and OCR results with and without exact row identifiers. Those results measure the fictional fixtures. Performance and savings on real patient bills still need validation.

Workflow inspiration from [BetterBill](https://github.com/matmanna/betterbill).
