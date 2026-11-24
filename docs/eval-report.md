# FairBill synthetic evaluation

Run from the repository root with `make eval`. The harness forces offline rule execution.

- Seeded bills 11. Clean bills 3.
- Seeded questions recovered 13/13 (100.0%).
- False questions on clean bills 0.
- Scenario totals checked 28.
- Claim-check probes passed 9/9.

A true positive must match the seeded rule, source row IDs, and proposed paise impact.

| Rule | True positives | False positives | False negatives | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| duplicates | 3 | 0 | 0 | 100.0% | 100.0% |
| quantities | 1 | 0 | 0 | 100.0% | 100.0% |
| unit_limit | 2 | 0 | 0 | 100.0% | 100.0% |
| line_arithmetic | 1 | 0 | 0 | 100.0% | 100.0% |
| invoice_arithmetic | 1 | 0 | 0 | 100.0% | 100.0% |
| settlement | 1 | 0 | 0 | 100.0% | 100.0% |
| reference_tariff | 3 | 0 | 0 | 100.0% | 100.0% |
| patient_report | 1 | 0 | 0 | 100.0% | 100.0% |

## OCR line recall

Exact row recall was 1/18 (5.6%), matching ID, type, code, date, quantity, unit price, and amount.
Matching with the ID excluded and case-insensitive service codes recovered 17/18 rows (94.4%).

| Fixture | Raster | Exact rows | Rows with canonical service codes |
| --- | --- | ---: | ---: |
| 11-seeded-independent-questions | clean | 0/4 | 4/4 |
| 11-seeded-independent-questions | slightly skewed | 0/4 | 4/4 |
| 12-clean-simple | clean | 0/2 | 2/2 |
| 12-clean-simple | slightly skewed | 1/2 | 1/2 |
| 13-clean-distinct-orders | clean | 0/3 | 3/3 |
| 13-clean-distinct-orders | slightly skewed | 0/3 | 3/3 |

Generated invoice rasters serve as controlled OCR inputs. Letter O and digit zero were frequently confused in row identifiers, and service code casing varied. Confirm the source rows manually before investigating a scan.

## Misses and scope

The labelled rule fixtures matched their expected findings and totals.

These fixtures are fictional. They cover labelled documents and illustrative references.
Coding judgments, device prices, prior authorization, and real eligibility remain outside the evaluated rules.
