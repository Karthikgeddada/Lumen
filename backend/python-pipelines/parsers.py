"""Lumen Python Pipelines — Module 1: Document Parsing Engine (core).

Pure parsing functions — no web framework imports, heavy libraries
(pdfplumber / python-docx / openpyxl / pandas) load lazily per call, and
only the ones the file type needs. Runs in two ways:
  1. In-process: the Node worker spawns parse_once.py per document (the
     production path — one service, zero configuration).
  2. Via the FastAPI harness in main.py (optional local dev HTTP service).

Output contract mirrors the Node ParsedDoc shape exactly:
{
  "pageCount": int|null, "ocrRequired": bool,
  "sections": [{"kind": "HEADING"|"PARAGRAPH", "headingPath": [...], "page": int|null, "order": int, "text": str}],
  "tables":   [{"page": int|null, "order": int, "title": str|null, "sheet": str|null, "header": [...]|null,
                "rows": [{"rowIndex": int, "cells": [str | {"v": str, "ref": str, "f": str}]}]}]
}
PDF responses additionally carry geometry (all additive keys, ignored by
older Node callers):
  "pages": [{"page": int, "width": float, "height": float, "headerText": str|null,
             "lines": [{"text": str, "bbox": {"x0","top","x1","bottom"}}]}]
  tables gain "pageWidth", "pageHeight", "bbox", "contextAbove" (the ~3
  nearest text lines above the table — where "(in thousands)" lives), and each
  row gains "bbox" + "cellBboxes" (aligned per-cell rects; null when the
  detected grid does not align 1:1 with the extracted cells — never guessed).
"""

import io
import statistics
from typing import Any


def parse_dispatch(data: bytes, name: str) -> dict[str, Any]:
    """Dispatch by the original file name's extension."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    base_name = name.rsplit(".", 1)[0]
    if ext == "pdf":
        return parse_pdf(data, base_name)
    if ext in ("docx", "doc"):
        return parse_docx(data)
    if ext == "xlsx":
        return parse_xlsx(data, base_name)
    if ext == "csv":
        return parse_csv(data, base_name)
    raise ValueError(f"Unsupported type: {ext or 'unknown'}")


# ── PDF ────────────────────────────────────────────────────────────────
def parse_pdf(data: bytes, base_name: str) -> dict[str, Any]:
    import pdfplumber

    sections: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    pages_out: list[dict[str, Any]] = []
    order = 0
    t_order = 0
    page_count = 0
    total_chars = 0
    heading_path: list[str] = []

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        for pno, page in enumerate(pdf.pages, start=1):
            # Find tables FIRST: their bounding boxes let us (a) title each
            # table from the nearest heading ABOVE it — never one from below
            # or from a later table, which would be a wrong citation — and
            # (b) keep table content out of the section text stream so it is
            # never double-reported (it is already chunked as table rows).
            found = page.find_tables()
            boxes = [t.bbox for t in found]  # (x0, top, x1, bottom)

            def in_table(w: dict) -> bool:
                cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
                return any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b in boxes)

            # Font-size-aware heading detection: a line rendered clearly
            # larger than the page's median text size is a heading. The median
            # is taken over ALL words (tables included — cell text is body-
            # sized) so a page that is mostly table still detects its title
            # heading; the section stream itself excludes table words.
            all_words = page.extract_words(extra_attrs=["size"])
            sizes_all = [w["size"] for w in all_words]
            body_size = statistics.median(sizes_all) if sizes_all else 0
            words = [w for w in all_words if not in_table(w)]
            raw: dict[int, list[tuple[float, float, str, float, float, float]]] = {}
            for w in words:
                key = round(w["top"] / 3)
                raw.setdefault(key, []).append((w["x0"], w["top"], w["text"], w["size"], w["x1"], w["bottom"]))

            # Text lines with bboxes — geometry for the evidence regions,
            # the section bboxes and the contextAbove scale detection reads.
            page_lines: list[dict[str, Any]] = []
            for key in sorted(raw):
                # Order words by x0 (reading order) — never by their text.
                ws = sorted(raw[key], key=lambda x: x[0])
                text = " ".join(t for _, _, t, _, _, _ in ws).strip()
                if not text:
                    continue
                total_chars += len(text)
                max_size = max(s for _, _, _, s, _, _ in ws)
                line = {
                    "text": text,
                    "size": max_size,
                    "bbox": {"x0": min(w[0] for w in ws), "top": min(w[1] for w in ws),
                             "x1": max(w[4] for w in ws), "bottom": max(w[5] for w in ws)},
                }
                is_heading = body_size and max_size >= body_size * 1.15 and len(text) <= 120
                if is_heading:
                    level = 2 if max_size < body_size * 1.5 else 1
                    heading_path = heading_path[: level - 1] + [text]
                    sections.append({"kind": "HEADING", "level": level, "headingPath": list(heading_path),
                                     "page": pno, "order": order, "text": text})
                else:
                    sections.append({"kind": "PARAGRAPH", "headingPath": list(heading_path),
                                     "page": pno, "order": order, "text": text})
                page_lines.append(line)
                order += 1

            for tbl in found:
                rows = [[(c or "").strip() for c in row] for row in (tbl.extract() or [])]
                rows = [r for r in rows if any(c for c in r)]
                if not rows:
                    continue
                # A first row with exactly one non-empty cell is the table's
                # own title ("Balance Sheets (In thousands)"), not a column
                # header — financial statements label their tables this way.
                title: str | None = None
                if len(rows[0]) > 0 and len([c for c in rows[0] if c]) == 1 and len(rows) > 1:
                    title_row = rows.pop(0)
                    title = next(c for c in title_row if c)
                # Title fallback chain, in order: the table's own title row;
                # the nearest text line above the table on this page (a
                # statement's label sits directly above its table); the last
                # heading seen on an earlier page; the file name. Never a
                # heading from below the table.
                tb = tbl.bbox
                above = [l for l in page_lines if l["bbox"]["bottom"] <= tb[1]]
                if title is None:
                    title = above[-1]["text"] if above else (heading_path[-1] if heading_path else base_name)
                # ~3 nearest lines above the table — where "(in thousands)"
                # and similar scale headers live.
                context_above = [l["text"] for l in above[-3:]]
                header, body = rows[0], rows[1:]

                # Per-cell bboxes from the detected grid, grouped by row top.
                # Null for rows whose grid does not align 1:1 with the
                # extracted cells — geometry is reported or absent, never
                # guessed.
                grid: dict[float, list[tuple[float, float, float, float]]] = {}
                for (x0, top, x1, bottom) in tbl.cells:
                    grid.setdefault(round(top, 1), []).append((x0, top, x1, bottom))
                tops = sorted(grid)
                rows_out = []
                for i, r in enumerate(body):
                    cell_bboxes = None
                    gi = i + 1  # grid row 0 corresponds to the header row
                    if gi < len(tops):
                        grp = sorted(grid[tops[gi]], key=lambda c: c[0])
                        if len(grp) == len(r):
                            cell_bboxes = [{"x0": c[0], "top": c[1], "x1": c[2], "bottom": c[3]} for c in grp]
                    rows_out.append({"rowIndex": i, "cells": r,
                                     "bbox": {"x0": tb[0], "top": tb[1], "x1": tb[2], "bottom": tb[3]},
                                     "cellBboxes": cell_bboxes})

                tables.append({"page": pno, "order": t_order,
                               "title": title,
                               "sheet": None, "header": header,
                               "pageWidth": float(page.width), "pageHeight": float(page.height),
                               "bbox": {"x0": tb[0], "top": tb[1], "x1": tb[2], "bottom": tb[3]},
                               "contextAbove": context_above,
                               "rows": rows_out})
                t_order += 1

            pages_out.append({"page": pno, "width": float(page.width), "height": float(page.height),
                              "headerText": page_lines[0]["text"] if page_lines else None,
                              "lines": [{"text": l["text"], "bbox": l["bbox"]} for l in page_lines]})

    return {"pageCount": page_count, "ocrRequired": total_chars == 0,
            "sections": sections, "tables": tables, "pages": pages_out}


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
