# FairBill hosted test

Android talks to FastAPI over HTTPS. FastAPI runs local OCR with Tesseract and uses Supabase Auth, Postgres and private Storage. The hosted service is configured for Render Singapore and the Supabase project is in Mumbai. The free Render service can take time to start after a period of inactivity.

## Deploy the API

Use the `render.yaml` Blueprint or create a free Singapore Docker web service with `./server/Dockerfile` and `./server` as its build context. Configure the health check at `/v1/health`.

| Environment variable | Value |
| --- | --- |
| `FAIRBILL_PROFILE` | `hosted` |
| `FAIRBILL_SUPABASE_URL` | `https://ehqolzlwsjvnwiervyid.supabase.co` |
| `FAIRBILL_SUPABASE_PUBLISHABLE_KEY` | Project publishable key |
| `FAIRBILL_SUPABASE_SERVICE_KEY` | Project secret key stored as a server environment variable |
| `FAIRBILL_PRIVACY_CONTACT` | `ryanfds2006@gmail.com` |

Set the Supabase secret directly in the host's environment panel. The Android build uses only the publishable key. Verify the API health check and the public `/privacy` and `/delete-account` pages over HTTPS. Confirm that an unauthenticated request to `/v1/cases` receives `401`.

## Build Android

Export `FAIRBILL_SUPABASE_PUBLISHABLE_KEY` and run `scripts/build-android.sh` for an installable APK. The build uses the FairBill HTTPS API, privacy page and Supabase project by default. Set `FAIRBILL_RELEASE_API_URL`, `FAIRBILL_PRIVACY_URL` and `FAIRBILL_SUPABASE_URL` to override those defaults for another hosted environment. Google Play release signing and Play Console submission are separate steps.

Use two authorized test accounts and synthetic bills to verify email sign-in, app relaunch, sync, photo and PDF ingestion, account isolation, redacted export, sign-out and deletion. Open the sign-in link on the same device or browser that requested it. A deletion from the public web page must also remove originals and reject the prior session. Test the mail and dialer handoffs with destinations controlled by the project team.

## What works on real cases

The rules can review duplicates, arithmetic, patient corrections, and differences against a supplied settlement document. Official tariff and policy sources need applicability checks before they can support calculated findings. See the [India pilot sources](india-pilot-sources.md). In the hosted app, patients send approved letters from their email app and place calls from their dialer. The sample case demonstrates simulated outreach.
