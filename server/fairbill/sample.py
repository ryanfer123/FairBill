from .documents import make_document

INVOICE = """FAIRBILL DEMO  /  SYNTHETIC HOSPITAL INVOICE
CHARGE | L01 | Inpatient care package | CARE | 2026-11-10 | 1 | 153500 | 153500
TOTAL | T01 | Invoice total | 156800
\fFAIRBILL DEMO  /  ITEMISED CHARGES
CHARGE | L43 | Complete blood count | CBC | 2026-11-10 | 1 | 900 | 900
CHARGE | L44 | Complete blood count | CBC | 2026-11-10 | 1 | 900 | 900
CHARGE | L45 | Dressing change | DRESS | 2026-11-10 | 3 | 500 | 1500"""
POLICY = """FAIRBILL DEMO  /  FICTIONAL POLICY EXCERPT
CLAUSE | P01 | Eligible inpatient procedures are assessed under this policy. | P-4.1
CLAUSE | P02 | The settlement statement lists any deduction with its applicable clause. | P-6.2"""
SETTLEMENT = """FAIRBILL DEMO  /  FICTIONAL SETTLEMENT STATEMENT
DEDUCTION | S01 | Deduction listed without a clause | 12000"""
RECORD = """FAIRBILL DEMO  /  FICTIONAL SERVICE RECORD
ORDER | O1 | Complete blood count order | CBC | 2026-11-10 | 1 | LAB-01
QUANTITY | Q1 | Dressing changes in service record | DRESS | 2026-11-10 | 2 | RECORD-01"""
SECOND = """FAIRBILL DEMO  /  SECOND LAB ORDER
ORDER | O2 | Complete blood count order | CBC | 2026-11-10 | 1 | LAB-02"""

FILES = (
    ("invoice", "invoice", INVOICE), ("policy", "policy", POLICY),
    ("settlement", "settlement", SETTLEMENT), ("record", "service_record", RECORD),
    ("second-order", "service_record", SECOND),
)


def fixtures():
    return [
        make_document(doc_id, kind, body.encode(), pasted=True, trusted=True)
        for doc_id, kind, body in FILES
    ]
