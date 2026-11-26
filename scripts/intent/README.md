# FairBill's local case assistant

The app uses a compact English text classifier trained on synthetic requests. Training builds word and character-feature centroids for seven case tasks. The runtime compares a request with those centroids on-device and offers a task picker when the score is low or the closest matches are too similar.

The selected task and current case revision determine the next step. The app opens the existing review, evidence, investigation, assistance or outreach workflow after the patient taps the next action. Requests, prediction and planning use the installed app. Cloud-backed actions retain their existing connection and approval requirements.

To regenerate the model, run `python3 scripts/intent/train.py` from the repository root. To evaluate actual runtime predictions after installing mobile dependencies:

```sh
mobile/node_modules/.bin/tsc mobile/src/case-intent.ts --target es2022 --module commonjs --resolveJsonModule --esModuleInterop --strict --outDir /tmp/fairbill-eval
node scripts/intent/evaluate.cjs /tmp/fairbill-eval/case-intent.js
```

The synthetic evaluation fixtures report classification mistakes and abstentions. They do not measure accuracy on patient requests.
