"""Pytest suite for the /parse sidecar.

Fixtures generate every format in-memory (reportlab for PDF, python-docx,
openpyxl, raw CSV bytes) — no binary fixtures in git. The PDF fixture mimics
a filing: a title, a "(in thousands, except per share data)" scale header
above a ruled table, and a body table with a per-share row (never scaled).

Run:  cd python-pipelines && pytest -q   (needs -r requirements-dev.txt)
"""

import io

import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(scope="module")
def client():
    return TestClient(main.app)


# ── Fixtures: synthetic documents ────────────────────────────────────
def make_pdf() -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(612, 792))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 720, "Consolidated Statements of Operations")
    c.setFont("Helvetica", 11)
    c.drawString(72, 700, "(in thousands, except per share data)")

    # Ruled 3x4 grid (1 header row + 3 body rows) — vector lines so the
    # pdfplumber "lines" strategy detects the table and its cell bboxes.
    xs = [72, 200, 330, 460]
    ys = [660, 620, 580, 540]  # tops of rows (pdf coords bottom-up)
    for y in ys:
        c.line(xs[0], y, xs[-1], y)
    for x in xs:
        c.line(x, ys[0], x, ys[-1])

    data = [
        ["Metric", "Q3 2026", "Q2 2026"],
        ["Revenue", "4,820", "4,510"],
        ["Net income", "610", "540"],
        ["EPS", "2.14", "1.90"],
    ]
    c.setFont("Helvetica", 10)
    for ri, y in enumerate(ys[:-1]):
        for ci, x in enumerate(xs[:-1]):
            c.drawString(x + 4, y - 20, data[ri][ci])

    c.showPage()
    c.save()
    return buf.getvalue()


def make_docx() -> bytes:
    import docx

    doc = docx.Document()
    doc.add_heading("Compliance Certificate", level=1)
    doc.add_paragraph("The borrower confirms all covenants were met.")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Covenant"
    table.cell(0, 1).text = "Value"
    table.cell(1, 0).text = "Leverage"
    table.cell(1, 1).text = "3.2x"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def make_xlsx() -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = "Metric"
    ws["B1"] = "Amount"
    ws["A2"] = "Revenue"
    ws["B2"] = 4820000
    ws["A3"] = "Total"
    ws["B3"] = "=SUM(B2:B2)"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── PDF: geometry + backward-compatible base shape ─────────────────
def test_pdf_base_contract_unchanged(client):
    res = client.post("/parse?name=report.pdf", content=make_pdf(),
                      headers={"Content-Type": "application/octet-stream"})
    assert res.status_code == 200
    body = res.json()
    # The exact keys the original Node contract expects.
    assert body["pageCount"] == 1
    assert body["ocrRequired"] is False
    assert isinstance(body["sections"], list) and body["sections"]
    assert all("kind" in s and "headingPath" in s and "order" in s and "text" in s for s in body["sections"])
    assert isinstance(body["tables"], list) and body["tables"]
    t = body["tables"][0]
    for key in ("page", "order", "title", "sheet", "header", "rows"):
        assert key in t
    assert t["header"] == ["Metric", "Q3 2026", "Q2 2026"]
    assert [r["cells"] for r in t["rows"]][0] == ["Revenue", "4,820", "4,510"]


def test_pdf_table_geometry(client):
    body = client.post("/parse?name=report.pdf", content=make_pdf()).json()
    t = body["tables"][0]
    assert t["page"] == 1
    assert t["pageWidth"] == 612 and t["pageHeight"] == 792
    assert all(k in t["bbox"] for k in ("x0", "top", "x1", "bottom"))
    for row in t["rows"]:
        assert all(k in row["bbox"] for k in ("x0", "top", "x1", "bottom"))
        # aligned grid rows carry per-cell bboxes; misaligned rows carry null —
        # never a guessed rectangle.
        assert row["cellBboxes"] is None or len(row["cellBboxes"]) == len(row["cells"])


def test_pdf_context_above_carries_scale_header(client):
    body = client.post("/parse?name=report.pdf", content=make_pdf()).json()
    ctx = body["tables"][0]["contextAbove"]
    assert any("in thousands" in line.lower() for line in ctx), ctx


def test_pdf_pages_lines_and_header(client):
    body = client.post("/parse?name=report.pdf", content=make_pdf()).json()
    pages = body["pages"]
    assert len(pages) == 1
    p = pages[0]
    assert p["page"] == 1 and p["width"] == 612 and p["height"] == 792
    assert p["headerText"] and "Consolidated" in p["headerText"]
    assert p["lines"] and all("bbox" in l for l in p["lines"])
    # words from the table cells also appear as page text
    joined = " ".join(l["text"] for l in p["lines"])
    assert "Revenue" in joined and "4,820" in joined


# ── Other formats still parse (no PDF-only regression) ─────────────
def test_docx_parses(client):
    body = client.post("/parse?name=cert.docx", content=make_docx()).json()
    assert body["sections"] and body["sections"][0]["kind"] == "HEADING"
    assert body["tables"] and body["tables"][0]["header"] == ["Covenant", "Value"]
    assert body["tables"][0]["rows"][0]["cells"] == ["Leverage", "3.2x"]


def test_xlsx_cells_carry_refs_and_formulas(client):
    body = client.post("/parse?name=book.xlsx", content=make_xlsx()).json()
    t = body["tables"][0]
    assert t["sheet"] == "Summary"
    cells = t["rows"][-1]["cells"]
    total = [c for c in cells if isinstance(c, dict)][0]
    assert total["ref"] == "B3" and total["f"] == "=SUM(B2:B2)"


def test_csv_parses(client):
    # Commas inside values must be quoted (real CSV rule) — pandas then keeps
    # "4,820" as one field.
    csv_bytes = b'Metric,Value\nRevenue,"4,820"\nNet income,610\n'
    body = client.post("/parse?name=data.csv", content=csv_bytes).json()
    assert body["tables"][0]["header"] == ["Metric", "Value"]
    assert body["tables"][0]["rows"][0]["cells"] == ["Revenue", "4,820"]
    assert body["tables"][0]["rows"][1]["cells"] == ["Net income", "610"]


# ── Guardrails ───────────────────────────────────────────────────
def test_unsupported_type_415(client):
    res = client.post("/parse?name=doc.txt", content=b"hello")
    assert res.status_code == 415


def test_malformed_pdf_422(client):
    res = client.post("/parse?name=bad.pdf", content=b"not a pdf")
    assert res.status_code == 422
