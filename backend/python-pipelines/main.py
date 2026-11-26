"""Lumen Python Pipelines — Module 1: Document Parsing Engine.

Open-source only (pdfplumber, python-docx, openpyxl, pandas). The parsing
logic lives in parsers.py; this file is only the optional local HTTP
harness — production runs it in-process instead (the Node worker spawns
parse_once.py, one service, zero configuration).

Response contract mirrors the Node ParsedDoc shape exactly:
{
  "pageCount": int|null, "ocrRequired": bool,
  "sections": [{"kind": "HEADING"|"PARAGRAPH", "headingPath": [...], "page": int|null, "order": int, "text": str}],
  "tables":   [{"page": int|null, "order": int, "title": str|null, "sheet": str|null, "header": [...]|null,
                "rows": [{"rowIndex": int, "cells": [str | {"v": str, "ref": str, "f": str}]}]}]
}

Run locally:  uvicorn main:app --port 8100
Call:         curl --data-binary @doc.pdf -H "Content-Type: application/octet-stream" \n              -H "X-Pipeline-Token: $PIPELINES_TOKEN" "localhost:8100/parse?name=doc.pdf"
"""

import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, Request

from parsers import parse_dispatch

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "100"))
TOKEN = os.environ.get("PIPELINES_TOKEN", "")

app = FastAPI(title="Lumen Pipelines", version="0.2.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "service": "pipelines", "module": "parsing"}


def _check_token(header: str | None) -> None:
    if TOKEN and header != TOKEN:
        raise HTTPException(status_code=401, detail="Invalid pipeline token")


def _check_size(data: bytes) -> None:
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_MB} MB limit")


# ── Dispatch ───────────────────────────────────────────────────────────
@app.post("/parse")
async def parse(
    request: Request,
    name: str = Query(..., description="Original file name, e.g. report.pdf"),
    x_pipeline_token: str | None = Header(default=None),
) -> dict[str, Any]:
    """Raw-body upload (application/octet-stream) — deliberately no multipart
    so no python-multipart dependency is needed."""
    _check_token(x_pipeline_token)
    data = await request.body()
    _check_size(data)

    try:
        return parse_dispatch(data, name)
    except ValueError as exc:  # unsupported extension
        raise HTTPException(status_code=415, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:  # malformed / password-protected files etc.
        raise HTTPException(status_code=422, detail=f"Parsing failed: {exc}")
