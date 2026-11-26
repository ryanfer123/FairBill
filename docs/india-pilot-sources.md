# India pilot sources

Last checked 24 November 2026. FairBill's hosted India source review supports selected Tata Memorial Parel charges and New India Mediclaim clauses. A comparison requires the patient to confirm the source applies to their documents.

| Review | Official source | Match before showing a finding |
| --- | --- | --- |
| Tata Memorial Hospital, Parel, Mumbai | [Tata Memorial Centre Schedule of Charges](https://tmc.gov.in/schedule-of-charges) and [published tariff PDF](https://tmc.gov.in/assets/PDF/SoC.pdf), printed version 6 dated 1 November 2026 | Match campus, service date, category, service code, rate unit and quantity. Identify the edition by the printed footer. The downloadable PDF's metadata title names an earlier version. |
| CGHS package comparison | [Delhi Directorate General of Health Services index](https://dgehs.delhi.gov.in/dghs/cghs-approved-rates-treatment-and-investigative-procedures) and [revised CGHS rates](https://dgehs.delhi.gov.in/sites/default/files/inline-files/cghs_rate.pdf) | Confirm CGHS applies to the case. Match the version effective on the treatment date, city tier, accreditation, ward entitlement and package inclusions. Label the result as a CGHS package comparison. |
| New India Assurance | [New India Mediclaim policy wording](https://www.newindia.co.in/assets/docs/know-more/health/new-india-mediclaim-policy/Policy%20Clause%20New%20India%20mediclaim%20%20.pdf), UIN `NIAHLIP25040V082425`, and [policy wording for UIN NIAHLIP25040V102425](https://www.newindia.co.in/assets/docs/know-more/health/new-india-mediclaim-policy/PolicyClause_%20NewIndiaMediclaimPolicy.pdf) | Match the UIN, coverage dates, issued schedule and endorsements. Compare with the insurer or third-party administrator's itemised settlement advice. Cite the applicable clause and the document line supporting the amount. |
| Tata Memorial financial assistance | [Tata Memorial patient booklet, section 14.2](https://tmc.gov.in/event/upload/12112025_5/TMH_Brochure_%20patient%20booklet.pdf) | Route potentially eligible patients to the hospital's Medical Social Work department for a means assessment. Show the steps and requirements described by the hospital. The hospital determines the category. |

For example, code `B001` in the published Tata Memorial tariff gives a daily room and bed charge of ₹420 for category `C` and ₹4,200 for category `B`. On a bill categorised as `C`, the app needs the number of billed days and the applicable edition before it can check the amount. [Tariff PDF, page 1](https://tmc.gov.in/assets/PDF/SoC.pdf#page=1)

The insurer's [blank health claim form](https://www.newindia.co.in/cms/24b38b03-6b17-42e8-b047-43c7784c6528/Claim_Form.pdf?guest=true) provides a layout reference. Validation on real documents needs at least one consented, de-identified itemised bill with its matching insurer or TPA settlement advice. The official sources reviewed here supplied neither a paired example nor permission to use patient documents.

## Pilot validation

In a hosted case, open **Review India price and policy sources** after confirming the bill and running the base checks. The review compares daily room and ICU charges for `B001` and `B003`. It covers service days from 1 November through the source verification date of 24 November 2026. Choose the printed category and confirm that the Parel schedule applies to the entire billed span. Update the supported date range only after checking the published edition again.

The policy review requires a confirmed invoice, issued policy and corresponding settlement advice. It matches the selected UIN to the policy text and points to clause 3.2 for room-related deductions. Assistance guidance follows the category shown on the Tata Memorial bill and directs the patient to the hospital. Reference differences are shown separately from the calculated scenario. The review does not issue eligibility decisions, calculate insurance reimbursement or persist new case data.

The API tests use synthetic invoice, policy and settlement records, including a generated itemised PDF. They cover paise arithmetic, date limits, incorrect editions, wrong policy versions, stale revisions and case ownership. Synthetic results do not establish OCR accuracy or savings on patient documents.

## Live hospital assistance pages

The lookup supports two hospital locations that can be checked directly over HTTPS.

| Hospital | Official source | Section |
| --- | --- | --- |
| AIIMS New Delhi, R.P. Centre | [Patient Welfare Services](https://aiims.edu/index.php/en/2023-07-19-08-55-03) | Exemption of Hospital Levy charges for BPL and Indigent patients |
| MPMMCC, Varanasi | [Medical Social Services](https://mpmmcc.tmc.gov.in/departments/medical-social-works) | The services provided by the department include |

In a case, open **Help with paying**, choose the hospital and campus, and tap **Check official page**. The assistant’s assistance goal opens the same screen. The lookup does not need an uploaded or confirmed bill. The Parel booklet and bill-category guidance remain available separately.

FairBill checks the registered HTTPS page at the time of the request and shows an excerpt only when the reviewed wording and its surrounding context still match. The check timestamp records the read attempt. It does not establish an eligibility or coverage date. A changed page is marked stale and its old excerpt is withheld. A failed request or unsupported hospital is shown separately. The hospital determines eligibility.

The authenticated API accepts only a case revision and a selected catalog ID. The public hospital request carries neither case data nor FairBill credentials. Hospital requests are limited to registered URLs and approved redirects with public, pinned destination addresses, TLS certificate checks, an eight-second deadline, and a 512 KiB uncompressed HTML limit. FairBill checks HTML text, skips explicitly hidden elements, and never executes scripts or fetches assets or page links. PDF and JavaScript-only sources remain outside live lookup.
