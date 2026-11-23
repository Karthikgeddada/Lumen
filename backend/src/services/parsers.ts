import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Parsers for each supported format. Everything preserves provenance:
// pages for PDFs, headings/paragraphs/footnotes for text documents, and
// sheet + cell references (with formulas when present) for spreadsheets.

export type ParsedCell = { v: string; ref: string; f?: string };
export type ParsedRow = { rowIndex: number; cells: (string | ParsedCell)[] };
export type ParsedTable = {
  sheet?: string;
  title?: string;
  page?: number | null;
  order: number;
  header: (string | ParsedCell)[] | null;
  rows: ParsedRow[];
};
export type ParsedSection = {
  kind: 'HEADING' | 'PARAGRAPH' | 'FOOTNOTE';
  level?: number;
  headingPath: string[];
  page: number | null;
  order: number;
  text: string;
};
export type ParsedDoc = {
  pageCount: number | null;
  ocrRequired: boolean;
  sections: ParsedSection[];
  tables: ParsedTable[];
};

// ── PDF ──────────────────────────────────────────────────────────────────
// pdf-parse splits pages on the form-feed character. Headings are detected
// heuristically (numbered or short title-case lines); footnotes after a
// "Footnotes"/"Notes" marker. Note: scanned PDFs without a text layer are
// flagged ocrRequired — they surface as NEEDS_REVIEW rather than silently
// pretending to be understood.
async function parsePdf(filePath: string): Promise<ParsedDoc> {
  // pdf-parse returns a Promise — it MUST be awaited (previously it wasn't,
  // so data.text was undefined and every real PDF upload crashed with
  // "Cannot read properties of undefined (reading 'split')").
  const data = await pdfParse(filePath);
  // Scanned/image-only PDFs can yield no text at all — treat as empty rather
  // than crashing; the ocrRequired flag below then surfaces NEEDS_REVIEW.
  const pages = (data?.text ?? '').split('\f');
  const sections: ParsedSection[] = [];
  let order = 0;
  let totalChars = 0;

  pages.forEach((pageText, pageIdx) => {
    const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean);
    let headingPath: string[] = [];
    let footnoteZone = false;

    for (const line of lines) {
      totalChars += line.length;
      if (/^(footnotes?|notes?)\b/i.test(line) && line.length < 20) {
        footnoteZone = true;
        headingPath = ['Footnotes'];
        sections.push({ kind: 'HEADING', headingPath: ['Footnotes'], page: pageIdx + 1, order: order++, text: line });
        continue;
      }

      // Numbered heading: "3. Results", "3.2 Segment revenue"
      const numbered = line.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.{2,90})$/);
      // Standalone short line in Title Case or ALL CAPS (unnumbered heading)
      const shortTitle =
        line.length <= 60 &&
        !/[.;:]$/.test(line) &&
        /^[A-Z0-9]/.test(line) &&
        (line === line.toUpperCase() || /^([A-Z][a-z]+\s){1,5}[A-Z]?[a-z]*$/.test(line));

      if (numbered && !/[$%]/.test(line)) {
        const level = numbered[1].split('.').length;
        headingPath = headingPath.slice(0, level - 1).concat([`${numbered[1]} ${numbered[2]}`]);
        sections.push({ kind: 'HEADING', level, headingPath: [...headingPath], page: pageIdx + 1, order: order++, text: `${numbered[1]} ${numbered[2]}` });
      } else if (shortTitle && !/^(the|a|an)\b/i.test(line) && line.split(/\s+/).length <= 8) {
        headingPath = [line];
        sections.push({ kind: 'HEADING', headingPath: [line], page: pageIdx + 1, order: order++, text: line });
      } else if (footnoteZone) {
        sections.push({ kind: 'FOOTNOTE', headingPath: [...headingPath], page: pageIdx + 1, order: order++, text: line });
      } else {
        sections.push({ kind: 'PARAGRAPH', headingPath: [...headingPath], page: pageIdx + 1, order: order++, text: line });
      }
    }
  });

  return {
    pageCount: data.numpages ?? pages.length,
    ocrRequired: totalChars < pages.length * 20, // effectively no text layer
    sections,
    tables: [], // pdf-parse has no table detector — PDF tables remain as paragraph text; see ENVIRONMENT/README notes
  };
}

// ── DOCX ──────────────────────────────────────────────────────────────
// mammoth gives semantic HTML; DOCX has no fixed pages, so page is null and
// the viewer presents flowing sections (clearly disclosed, never invented).
const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

async function parseDocx(buffer: Buffer): Promise<ParsedDoc> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const sections: ParsedSection[] = [];
  const tables: ParsedTable[] = [];
  let order = 0;
  let tOrder = 0;
  let headingPath: string[] = [];

  const tagRe = /<(h[1-4]|p|table)\b[^>]*>(.*?)<\/\1>/gs;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[1];
    const inner = m[2];
    if (tag === 'table') {
      const rowsHtml = [...inner.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gs)];
      const parsedRows: ParsedRow[] = rowsHtml.map((r, i) => ({
        rowIndex: i,
        cells: [...r[1].matchAll(/<t[dh]\b[^>]*>(.*?)<\/t[dh]>/gs)].map((c) => stripTags(c[1])),
      }));
      const header = parsedRows.length ? parsedRows[0].cells : null;
      const rows = parsedRows.slice(1);
      if (rows.length) {
        tables.push({ page: null, order: tOrder++, header, rows, title: headingPath.at(-1) });
        // Table content also becomes retrievable paragraph text (per-row chunks are built from the table itself).
      }
    } else if (/^h[1-4]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      const text = stripTags(inner).trim();
      if (text) {
        headingPath = headingPath.slice(0, level - 1).concat([text]);
        sections.push({ kind: 'HEADING', level, headingPath: [...headingPath], page: null, order: order++, text });
      }
    } else {
      const text = stripTags(inner).trim();
      if (text) sections.push({ kind: 'PARAGRAPH', headingPath: [...headingPath], page: null, order: order++, text });
    }
  }
  return { pageCount: null, ocrRequired: sections.length === 0, sections, tables };
}

// ── Spreadsheets (XLSX / XLS / CSV) ─────────────────────────────────────
function parseSheet(buffer: Buffer, baseName: string): ParsedDoc {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true });
  const tables: ParsedTable[] = [];
  let tOrder = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;

    // ref → value / formula map so provenance survives ("Q3!B7" / =SUM…)
    const cellMap = new Map<string, { v: string; f?: string }>();
    for (const key of Object.keys(sheet)) {
      if (key.startsWith('!')) continue;
      const cell = sheet[key] as { v?: unknown; f?: string; w?: string };
      const display = cell.w ?? (cell.v != null ? String(cell.v) : '');
      if (display === '' && !cell.f) continue;
      cellMap.set(key, { v: display, f: cell.f });
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
    if (!matrix.length) continue;

    const toCells = (row: unknown[], rowIdx: number): (string | ParsedCell)[] =>
      row.slice(0, 60).map((raw, c) => {
        const ref = XLSX.utils.encode_cell({ r: rowIdx, c });
        const hit = cellMap.get(ref);
        const v = raw == null ? '' : String(raw);
        if (hit?.f) return { v, ref, f: hit.f };
        return v;
      });

    const headerRowIdx = matrix.findIndex((r) => (r as unknown[]).some((c) => String(c ?? '').trim() !== ''));
    const header = headerRowIdx >= 0 ? toCells(matrix[headerRowIdx], headerRowIdx).map((c) => (typeof c === 'string' ? c : c.v)) : null;
    const rows = matrix
      .slice(headerRowIdx + 1)
      .map((r, i) => ({ rowIndex: i, cells: toCells(r as unknown[], headerRowIdx + 1 + i) }));

    tables.push({ sheet: sheetName, title: `${baseName} — ${sheetName}`, page: null, order: tOrder++, header, rows });
  }

  const sections: ParsedSection[] = tables.flatMap((t) => [
    { kind: 'HEADING' as const, headingPath: [t.sheet!], page: null, order: t.order, text: `Sheet: ${t.sheet}` },
  ]);
  return { pageCount: null, ocrRequired: tables.length === 0, sections, tables };
}

// ── Plain text ───────────────────────────────────────────────────────────
function parseTxt(buffer: Buffer): ParsedDoc {
  const text = buffer.toString('utf8');
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return {
    pageCount: 1,
    ocrRequired: blocks.length === 0,
    sections: blocks.map((b, i) => ({ kind: 'PARAGRAPH' as const, headingPath: [], page: 1, order: i, text: b })),
    tables: [],
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────
export async function parseDocument(filePath: string, ext: string, baseName: string): Promise<ParsedDoc> {
  switch (ext) {
    case 'pdf':
      return parsePdf(filePath);
    case 'docx':
    case 'doc':
      // .doc (legacy) parsing is best-effort via mammoth; convert beforehand for best results
      return parseDocx(fs.readFileSync(filePath));
    case 'xlsx':
    case 'xls':
    case 'csv':
      return parseSheet(fs.readFileSync(filePath), baseName);
    case 'txt':
      return parseTxt(fs.readFileSync(filePath));
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

export const SUPPORTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'];
export const extOf = (filename: string) => path.extname(filename).replace('.', '').toLowerCase();
