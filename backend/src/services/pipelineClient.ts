// Client for the Python parsing pipelines (backend/python-pipelines/).
//
// Two ways the worker reaches the Python parsers, in precedence order:
//   1. Local in-process (the default, production path): parseDocument()
//      spawns python-pipelines/parse_once.py per document — pdfplumber
//      reconstructs PDF financial tables, python-docx reads true body
//      order, openpyxl keeps values + formulas with cell refs. One service,
//      zero configuration.
//   2. Remote sidecar (optional, advanced): when PARSE_SERVICE_URL is set,
//      e.g. to split the Python workload onto its own service later.
// Every failure mode — disabled, missing script/interpreter, timeout,
// nonzero exit, malformed payload — reports a reason and falls back to the
// in-process JS parsers, so an upload NEVER fails because Python is down;
// the reason is logged so a stuck parser is never a mystery.
//
// The response mapping is deliberately strict: any shape violation rejects
// the whole payload and falls back, because a half-trusted parse is worse
// than an honest JS parse. Pure logic here is unit-tested without any
// Python running (pipelineClient.test.ts).

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import type { ParsedCell, ParsedDoc, ParsedSection, ParsedTable } from './parsers';

export interface SidecarEnv {
  url: string;
  token: string;
  timeoutMs: number;
}

/** ok — the mapped document; !ok — a machine-readable fallback reason. */
export type SidecarOutcome = { ok: true; doc: ParsedDoc } | { ok: false; reason: string };

/** Sidecar config from the environment; null means "not configured" (JS parsers only). */
export function sidecarEnv(): SidecarEnv | null {
  const url = (process.env.PARSE_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
  if (!url) return null;
  const raw = Number(process.env.PARSE_TIMEOUT_MS ?? '120000');
  const timeoutMs = Number.isFinite(raw) && raw >= 1000 ? raw : 120000;
  return { url, token: (process.env.PIPELINES_TOKEN ?? '').trim(), timeoutMs };
}

/**
 * Formats the Python parsers handle better than the JS parsers. Legacy
 * .xls and .doc stay local — openpyxl and python-docx do not read them.
 */
export function sidecarSupported(ext: string): boolean {
  return ext === 'pdf' || ext === 'docx' || ext === 'xlsx' || ext === 'csv';
}

// ── Local in-process Python (production path: one service, zero config) ──

/** Local Python runner config from the environment. */
export interface LocalPythonEnv {
  bin: string;
  scriptPath: string;
  timeoutMs: number;
}

export function localPythonEnv(): LocalPythonEnv {
  const raw = Number(process.env.PARSE_TIMEOUT_MS ?? '120000');
  return {
    bin: (process.env.LUMEN_PYTHON_BIN ?? 'python3').trim() || 'python3',
    // Resolved against the backend root — the cwd of the api/worker
    // process both in dev (tsx) and on Render (rootDir: backend).
    scriptPath: path.resolve((process.env.LUMEN_PYTHON_SCRIPT ?? 'python-pipelines/parse_once.py').trim()),
    timeoutMs: Number.isFinite(raw) && raw >= 1000 ? raw : 120000,
  };
}

/** LUMEN_PYTHON_PARSERS=false|0|off disables the in-process Python parsers (JS only). */
export function pythonParsersEnabled(): boolean {
  const flag = (process.env.LUMEN_PYTHON_PARSERS ?? '').trim().toLowerCase();
  return flag !== 'false' && flag !== '0' && flag !== 'off';
}

/**
 * Spawn parse_once.py on a file and map its stdout JSON (same contract as
 * the HTTP /parse endpoint). Never throws: every failure is a
 * { ok: false, reason } the caller turns into a JS-parser fallback + log.
 */
export function parseViaLocalPython(env: LocalPythonEnv, filePath: string, name: string): Promise<SidecarOutcome> {
  if (!existsSync(env.scriptPath)) {
    return Promise.resolve({ ok: false, reason: `python parser script not found at ${env.scriptPath}` });
  }
  return new Promise((resolve) => {
    execFile(env.bin, [env.scriptPath, filePath, name], { timeout: env.timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        const e = err as { killed?: boolean; code?: unknown; stderr?: string };
        if (e.killed) {
          resolve({ ok: false, reason: `python parser timed out after ${env.timeoutMs} ms` });
        } else if (e.code === 'ENOENT') {
          resolve({ ok: false, reason: `python interpreter not found: ${env.bin}` });
        } else {
          resolve({ ok: false, reason: `python parser exited with code ${String(e.code ?? '?')}: ${String(e.stderr ?? '').slice(0, 200)}` });
        }
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(stdout);
      } catch {
        resolve({ ok: false, reason: 'python parser returned invalid JSON' });
        return;
      }
      const doc = mapSidecarResponse(payload);
      resolve(doc ? { ok: true, doc } : { ok: false, reason: 'python parser payload did not match the parse contract' });
    });
  });
}

// ── Response mapping (strict: any violation → null → JS-parser fallback) ──

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function mapCell(raw: unknown): string | ParsedCell | null {
  if (raw == null) return '';
  if (isStr(raw)) return raw;
  if (typeof raw === 'object') {
    const o = raw as { v?: unknown; ref?: unknown; f?: unknown };
    if (isStr(o.v)) {
      // Formula cell from openpyxl: keep ref + formula provenance.
      if (isStr(o.ref)) return { v: o.v, ref: o.ref, ...(isStr(o.f) ? { f: o.f } : {}) };
      return o.v;
    }
  }
  return null;
}

function mapSection(raw: unknown): ParsedSection | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (!isStr(s.text)) return null;
  if (!Array.isArray(s.headingPath) || !s.headingPath.every(isStr)) return null;
  if (s.order !== undefined && !isNum(s.order)) return null;
  const page = s.page === undefined || s.page === null ? null : isNum(s.page) ? s.page : null;
  if (s.page !== undefined && s.page !== null && !isNum(s.page)) return null;
  const level = isNum(s.level) ? s.level : undefined;
  return {
    kind: s.kind === 'HEADING' ? 'HEADING' : 'PARAGRAPH',
    ...(level != null ? { level } : {}),
    headingPath: s.headingPath,
    page,
    order: isNum(s.order) ? s.order : 0,
    text: s.text,
  };
}

function mapRow(raw: unknown): { rowIndex: number; cells: (string | ParsedCell)[] } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.cells)) return null;
  const cells: (string | ParsedCell)[] = [];
  for (const c of r.cells) {
    const m = mapCell(c);
    if (m === null) return null;
    cells.push(m);
  }
  return { rowIndex: isNum(r.rowIndex) ? r.rowIndex : 0, cells };
}

function mapTable(raw: unknown): ParsedTable | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  if (!Array.isArray(t.rows)) return null;
  if (t.order !== undefined && !isNum(t.order)) return null;
  if (t.page !== undefined && t.page !== null && !isNum(t.page)) return null;

  let header: (string | ParsedCell)[] | null = null;
  if (t.header != null) {
    if (!Array.isArray(t.header)) return null;
    header = [];
    for (const c of t.header) {
      const m = mapCell(c);
      if (m === null) return null;
      header.push(m);
    }
  }

  const rows: { rowIndex: number; cells: (string | ParsedCell)[] }[] = [];
  for (const r of t.rows) {
    const m = mapRow(r);
    if (m === null) return null;
    rows.push(m);
  }

  return {
    sheet: isStr(t.sheet) ? t.sheet : undefined,
    title: isStr(t.title) ? t.title : undefined,
    page: t.page === undefined || t.page === null ? null : (t.page as number),
    order: isNum(t.order) ? t.order : 0,
    header,
    rows,
  };
}

/** Map a sidecar /parse response to ParsedDoc, or null if it violates the contract. */
export function mapSidecarResponse(raw: unknown): ParsedDoc | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.sections) || !Array.isArray(o.tables)) return null;
  if (typeof o.ocrRequired !== 'boolean') return null;
  if (o.pageCount !== null && !isNum(o.pageCount)) return null;

  const sections: ParsedSection[] = [];
  for (const s of o.sections) {
    const m = mapSection(s);
    if (m === null) return null;
    sections.push(m);
  }
  const tables: ParsedTable[] = [];
  for (const t of o.tables) {
    const m = mapTable(t);
    if (m === null) return null;
    tables.push(m);
  }
  return {
    pageCount: o.pageCount == null ? null : (o.pageCount as number),
    ocrRequired: o.ocrRequired,
    sections,
    tables,
  };
}

/**
 * POST the file bytes to the sidecar's /parse and map the response.
 * Never throws: every failure is a { ok: false, reason } the caller turns
 * into a JS-parser fallback + a log line.
 */
export async function parseViaSidecar(env: SidecarEnv, body: Uint8Array, name: string): Promise<SidecarOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.timeoutMs);
  try {
    const res = await fetch(`${env.url}/parse?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(env.token ? { 'X-Pipeline-Token': env.token } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `sidecar responded ${res.status}` };
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return { ok: false, reason: 'sidecar returned invalid JSON' };
    }
    const doc = mapSidecarResponse(payload);
    return doc ? { ok: true, doc } : { ok: false, reason: 'sidecar payload did not match the parse contract' };
  } catch (err) {
    const errName = (err as { name?: unknown } | null)?.name;
    return {
      ok: false,
      reason: errName === 'AbortError' ? `sidecar timed out after ${env.timeoutMs} ms` : 'sidecar unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}
