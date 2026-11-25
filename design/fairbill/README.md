# FairBill mobile design

Open [the interactive prototype](index.html) in a browser. It works offline and keeps the fictional case in the current tab. The screen index opens any view directly. The dark mode control changes the phone preview.

Open [FairBill — Design & Assets](https://framer.com/projects/EpjXfOnuPAz6yc05aBaB) in Framer for the editable screen layouts. In **Design pages → FairBill Mobile**, the asset board shows the shared colors, typography, icons, and components. The other four boards cover capture, review, assistance and outreach, and account access. Use the HTML prototype to walk through the interactions.

## Visual direction

FairBill uses the visual language of an itemised bill. The dark green account total establishes hierarchy, rows align labels to tabular amounts, and the source view reads like an annotated record. Warm paper tones carry the reading surfaces. The colors, tonal actions, bottom navigation and component states take their direction from Material 3 and the supplied FairBill reference. The original BetterBill flow informed two decisions. Patients can compare an extracted line with its source before confirming it, and a reported amount opens the evidence behind it.

A single primary action comes first on each task screen. Prominent motion is reserved for task feedback. Status text accompanies color and icons. Retain the layout and meaning if system type size, reduced motion or the device theme changes.

## Native implementation map

| Flow | Screens and states | Expo entry point |
| --- | --- | --- |
| Start | Check a bill, document chooser, paste, reading and retry, empty or populated case list | `mobile/app/index.tsx`, `mobile/src/intake.tsx`, `mobile/src/cases.tsx` |
| Review | Confirm lines, correct a charge, review checklist, findings, evidence, documents, timeline and past revision | `mobile/app/case/[id].tsx`, `mobile/src/intake.tsx`, `mobile/src/results.tsx` |
| Get help | Assistance inputs and clause, action status, letter, call and redacted preview | `mobile/src/assistance.tsx`, `mobile/src/case-actions.tsx`, `mobile/src/outreach.tsx`, `mobile/app/case/[id].tsx` |
| Access | Email, one-time code, account settings, deletion confirmation and test connection | `mobile/src/account.tsx`, `mobile/app/index.tsx`, `mobile/src/connection.tsx` |

Use native camera, file, and share controls. Keep the active case and the current revision across nested screens. The review queue should distinguish a pending confirmation from a confirmed document awaiting investigation. Keep the insurer deduction outside the invoice subtotal. A historical revision carries its own amount and evidence. The approved wording, the call’s verification gate, and the packet’s redactions should come from the existing backend rather than from preview state.

## Design review walk

Start with **Add a bill**, choose **Paste text**, and fill the sample. On the document screen, open **Page 2, line 3**, then correct the charge and confirm. Run the checks, add the second lab order, and rerun. The conditional invoice changes from ₹1,55,400 to ₹1,56,300. The ₹12,000 insurer deduction stays separate. The timeline still shows the earlier figure.

From **Act**, approve the sample letter, edit it, and verify that the updated wording requires approval. Start a simulated call and confirm that identity verification precedes the advocate’s request. Open the redacted packet and preview sharing.

The HTML uses sample data for all these interactions. It does not connect to a backend or trigger real outreach, file sharing, sign-in, or account deletion.
