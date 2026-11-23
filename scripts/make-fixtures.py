"""Render FairBill's original synthetic inputs as printable judge-demo documents."""

from pathlib import Path

import pymupdf

from fairbill.sample import FILES

ROOT = Path(__file__).resolve().parents[1]


def render(name, body):
    with pymupdf.open() as pdf:
        for text in body.split("\f"):
            page = pdf.new_page(width=680, height=780)
            heading, *lines = text.splitlines()
            page.draw_rect(pymupdf.Rect(30, 30, 650, 94), fill=(0.07, 0.21, 0.17))
            page.insert_text((48, 68), heading, fontsize=16, fontname="hebo", color=(0.91, 0.97, 0.88))
            for index, line in enumerate(lines):
                page.insert_text((46, 136 + 33 * index), line.replace(" | ", "  |  "), fontsize=10, fontname="cour")
            page.insert_text((46, 740), "FairBill / Team Honey Potato / Synthetic document for demonstration",
                             fontsize=10, fontname="helv", color=(0.3, 0.4, 0.35))
        pdf.save(ROOT / "demo" / f"{name}.pdf", deflate=True)


for name, _, text in FILES:
    render(name, text)

render("scan-invoice", """FAIRBILL DEMO  /  ONE-PAGE SCAN SAMPLE
CHARGE | C01 | Consultation | CONSULT | 2026-11-10 | 1 | 1500 | 1500
TOTAL | T01 | Invoice total | 1500""")
