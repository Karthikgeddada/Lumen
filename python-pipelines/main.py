"""Lumen Python Pipelines — Module 1: Document Parsing Engine.

Open-source only (pdfplumber, python-docx, openpyxl, pandas). Runs as a
FastAPI service the Node worker calls when PARSE_SERVICE_URL is set; Node
falls back to its JS parsers when the service is unreachable, so this is
strictly additive.

Response contract mirrors the Node ParsedDoc shape exactly:
{
  "pageCount": int|null, "ocrRequired": bool,
  "sections": [{"kind": "HEADING"|"PARAGRAPH", "headingPath": [...], "page": int|null, "order": int, "text": str}],
  "tables":   [{"page": int|null, "order": int, "title": str|null, "sheet": str|null, "header": [...]|null,
                "rows": [{"rowIndex": int, "cells": [str | {"v": str, "ref": str, "f": str}]}]}]
}

Run locally:  uvicorn main:app --port 8100
Call:         curl -F file=@doc.pdf -H "X-Pipeline-Token: $PIPELINES_TOKEN" localhost:8100/parse
"""

import io
import os
import statistics
from typing import Any

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "100"))
TOKEN = os.environ.get("PIPELINES_TOKEN", "")

app = FastAPI(title="Lumen Pipelines", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "service": "pipelines", "module": "parsing"}


def _check_token(header: str | None) -> None:
    if TOKEN and header != TOKEN:
        raise HTTPException(status_code=401, detail="Invalid pipeline token")


def _check_size(data: bytes) -> None:
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_MB} MB limit")


# ── PDF ────────────────────────────────────────────────────────────────
def parse_pdf(data: bytes, base_name: str) -> dict[str, Any]:
    import pdfplumber

    sections: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    order = 0
    t_order = 0
    page_count = 0
    total_chars = 0
    heading_path: list[str] = []

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        for pno, page in enumerate(pdf.pages, start=1):
            # Font-size-aware heading detection: a line rendered clearly
            # larger than the page's median text size is a heading.
            words = page.extract_words(extra_attrs=["size"])
            lines: dict[int, list[tuple[float, str, float]]] = {}
            for w in words:
                key = round(w["top"] / 3)
                lines.setdefault(key, []).append((w["x0"], w["text"], w["size"]))
            sizes = [s for ws in lines.values() for _, _, s in ws]
            body_size = statistics.median(sizes) if sizes else 0

            for key in sorted(lines):
                # Order words by x0 (reading order) — never by their text.
                ws = sorted(lines[key], key=lambda x: x[0])
                text = " ".join(t for _, t, _ in ws).strip()
                max_size = max(s for _, _, s in ws)
                if not text:
                    continue
                total_chars += len(text)
                is_heading = body_size and max_size >= body_size * 1.15 and len(text) <= 120
                if is_heading:
                    level = 2 if max_size < body_size * 1.5 else 1
                    heading_path = heading_path[: level - 1] + [text]
                    sections.append({"kind": "HEADING", "level": level, "headingPath": list(heading_path),
                                     "page": pno, "order": order, "text": text})
                else:
                    sections.append({"kind": "PARAGRAPH", "headingPath": list(heading_path),
                                     "page": pno, "order": order, "text": text})
                order += 1

            for tbl in page.extract_tables() or []:
                rows = [[(c or "").strip() for c in row] for row in tbl]
                rows = [r for r in rows if any(c for c in r)]
                if not rows:
                    continue
                header, body = rows[0], rows[1:]
                tables.append({"page": pno, "order": t_order,
                               "title": heading_path[-1] if heading_path else base_name,
                               "sheet": None, "header": header,
                               "rows": [{"rowIndex": i, "cells": r} for i, r in enumerate(body)]})
                t_order += 1

    return {"pageCount": page_count, "ocrRequired": total_chars == 0,
            "sections": sections, "tables": tables}


# ── DOCX ───────────────────────────────────────────────────────────────
def parse_docx(data: bytes) -> dict[str, Any]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = docx.Document(io.BytesIO(data))
    sections: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    order = 0
    t_order = 0
    heading_path: list[str] = []

    # Walk the body in true document order (paragraphs and tables interleaved).
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            para = Paragraph(child, doc)
            text = para.text.strip()
            if not text:
                continue
            style = (para.style.name or "") if para.style is not None else ""
            level = 0
            if style.lower().startswith("heading"):
                try:
                    level = int(style.split()[-1])
                except ValueError:
                    level = 1
            if 1 <= level <= 4:
                heading_path = heading_path[: level - 1] + [text]
                sections.append({"kind": "HEADING", "level": level, "headingPath": list(heading_path),
                                 "page": None, "order": order, "text": text})
            else:
                sections.append({"kind": "PARAGRAPH", "headingPath": list(heading_path),
                                 "page": None, "order": order, "text": text})
            order += 1
        elif child.tag.endswith("}tbl"):
            table = Table(child, doc)
            rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]
            rows = [r for r in rows if any(c for c in r)]
            if not rows:
                continue
            header, body = rows[0], rows[1:]
            tables.append({"page": None, "order": t_order,
                           "title": heading_path[-1] if heading_path else None,
                           "sheet": None, "header": header,
                           "rows": [{"rowIndex": i, "cells": r} for i, r in enumerate(body)]})
            t_order += 1

    return {"pageCount": None, "ocrRequired": len(sections) == 0,
            "sections": sections, "tables": tables}


# ── XLSX / CSV ─────────────────────────────────────────────────────────
def parse_xlsx(data: bytes, base_name: str) -> dict[str, Any]:
    import openpyxl

    wb_values = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    wb_formulas = openpyxl.load_workbook(io.BytesIO(data), data_only=False, read_only=True)
    tables: list[dict[str, Any]] = []
    t_order = 0

    for sheet_name in wb_values.sheetnames:
        ws_v = wb_values[sheet_name]
        ws_f = wb_formulas[sheet_name]
        rows_out: list[dict[str, Any]] = []
        header: list[str] | None = None
        first_data_row = 0

        for r_idx, row in enumerate(ws_v.iter_rows(), start=1):
            cells: list[Any] = []
            for c_idx, cell in enumerate(row, start=1):
                value = cell.value
                formula = None
                try:
                    f_cell = ws_f.cell(row=r_idx, column=c_idx)
                    if isinstance(f_cell.value, str) and f_cell.value.startswith("="):
                        formula = f_cell.value
                except Exception:
                    pass
                if value is None and formula is None:
                    cells.append("")
                elif formula:
                    cells.append({"v": "" if value is None else str(value),
                                  "ref": cell.coordinate, "f": formula})
                else:
                    cells.append(str(value))
            # Trim fully-empty trailing cells.
            while cells and cells[-1] in ("", None):
                cells.pop()
            if not cells:
                continue
            if header is None:
                header = [c if isinstance(c, str) else c.get("v", "") for c in cells]
                first_data_row = r_idx
                continue
            rows_out.append({"rowIndex": r_idx - first_data_row - 1, "cells": cells})

        if header is not None:
            tables.append({"page": None, "order": t_order,
                           "title": f"{base_name} — {sheet_name}", "sheet": sheet_name,
                           "header": header, "rows": rows_out})
            t_order += 1

    wb_values.close()
    wb_formulas.close()
    sections = [{"kind": "HEADING", "headingPath": [t["sheet"]], "page": None, "order": t["order"],
                 "text": f"Sheet: {t['sheet']}"} for t in tables]
    return {"pageCount": None, "ocrRequired": len(tables) == 0,
            "sections": sections, "tables": tables}


def parse_csv(data: bytes, base_name: str) -> dict[str, Any]:
    import pandas as pd

    df = pd.read_csv(io.BytesIO(data), dtype=str, keep_default_na=False, nrows=5000)
    header = list(df.columns)
    rows = [{"rowIndex": i, "cells": [str(v) for v in row]} for i, row in enumerate(df.itertuples(index=False, name=None))]
    table = {"page": None, "order": 0, "title": base_name, "sheet": None,
             "header": header, "rows": rows}
    section = {"kind": "HEADING", "headingPath": [base_name], "page": None, "order": 0, "text": base_name}
    return {"pageCount": 1, "ocrRequired": len(rows) == 0, "sections": [section], "tables": [table]}


# ── Dispatch ───────────────────────────────────────────────────────────
@app.post("/parse")
async def parse(file: UploadFile = File(...), x_pipeline_token: str | None = Header(default=None)) -> dict[str, Any]:
    _check_token(x_pipeline_token)
    data = await file.read()
    _check_size(data)
    name = file.filename or "document"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    base_name = name.rsplit(".", 1)[0]

    try:
        if ext == "pdf":
            return parse_pdf(data, base_name)
        if ext in ("docx", "doc"):
            return parse_docx(data)
        if ext == "xlsx":
            return parse_xlsx(data, base_name)
        if ext == "csv":
            return parse_csv(data, base_name)
        raise HTTPException(status_code=415, detail=f"Unsupported type: {ext or 'unknown'}")
    except HTTPException:
        raise
    except Exception as exc:  # malformed / password-protected files etc.
        raise HTTPException(status_code=422, detail=f"Parsing failed: {exc}")
