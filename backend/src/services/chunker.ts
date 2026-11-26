import type { ParsedCell, ParsedDoc, ParsedTable, ParsedSection } from './parsers';

// Retrieval units. Every chunk keeps its source pointers — page, heading
// breadcrumb, table identity — so every AI answer can cite exactly where a
// fact came from.

export type ChunkDraft = {
  page: number | null;
  sheet: string | null;
  headingPath: string[];
  tableId?: string; // assigned after table rows are persisted
  tableIndex?: number; // position in the parsed tables array
  rowIndex?: number;
  kind: 'PARAGRAPH' | 'TABLE_ROW' | 'FOOTNOTE' | 'SHEET';
  text: string;
  regions?: unknown[]; // evidence geometry (PDF bboxes | DOCX paragraph | XLSX range | TXT lines)
};

const MAX_CHUNK_CHARS = 1800;

export function chunksFromSections(doc: ParsedDoc): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  let current: { page: number | null; path: string[]; parts: ParsedSection[] } | null = null;

  const flush = () => {
    if (!current || current.parts.length === 0) return;
    const path = current.parts[0].headingPath;
    const label = path.length ? `${path.join(' › ')}\n` : '';
    const body = current.parts.map((p) => p.text).join('\n');
    // Evidence regions: PDF → line bboxes on the page; TXT → 1-based line
    // range; DOCX → paragraph index (no fixed pages). Never fabricated.
    const regions = current.parts
      .map((p): object | null => {
        if (p.lineStart != null) return { startLine: p.lineStart, endLine: p.lineEnd ?? p.lineStart };
        if (p.bbox && p.page != null) return { page: p.page, bbox: p.bbox };
        if (p.page == null) return { paragraph: p.order };
        return null;
      })
      .filter((r): r is object => r != null);
    out.push({
      page: current.page,
      sheet: null,
      headingPath: path,
      kind: current.parts.some((p) => p.kind === 'FOOTNOTE') ? 'FOOTNOTE' : 'PARAGRAPH',
      text: label + body,
      regions,
    });
    current = null;
  };

  for (const section of doc.sections) {
    if (section.kind === 'HEADING') {
      flush(); // headings start a new chunk so chunks stay topically coherent
      continue;
    }
    const samePage = current && current.page === section.page;
    const samePath = current && JSON.stringify(current.path) === JSON.stringify(section.headingPath);
    const size = current ? current.parts.reduce((n, p) => n + p.text.length + 1, 0) : 0;

    if (!current || !samePage || !samePath) {
      flush();
      current = { page: section.page, path: [...section.headingPath], parts: [section] };
    } else if (size + section.text.length <= MAX_CHUNK_CHARS) {
      current.parts.push(section);
    } else {
      flush();
      current = { page: section.page, path: [...section.headingPath], parts: [section] };
    }
  }
  flush();
  return out;
}

export function chunksFromTable(table: ParsedTable, tableIndex: number): ChunkDraft[] {
  const cols = (table.header as (string | { v: string })[] | null)?.map((h) => (typeof h === 'string' ? h : h.v)) ?? [];
  const out: ChunkDraft[] = [];

  // Header context keeps every row chunk self-describing.
  const headerLine = cols.length ? `Columns: ${cols.join(' | ')}` : '';
  const loc = table.sheet ? ` (sheet “${table.sheet}”)` : table.page != null ? ` (page ${table.page})` : '';

  for (const row of table.rows) {
    const pairs = row.cells
      .map((cell, i) => {
        const label = cols[i] || `Col ${i + 1}`;
        if (typeof cell === 'string') return `${label}: ${cell}`;
        const f = cell.f ? ` [formula ${cell.f}]` : '';
        return `${label}: ${cell.v}${f} (${cell.ref})`;
      })
      .join('\n');
    // Regions: PDF rows carry their bbox on the page; spreadsheet rows cite
    // the sheet + first..last cell range.
    let regions: object[] | undefined;
    if (row.bbox && table.page != null) {
      regions = [{ page: table.page, bbox: row.bbox }];
    } else if (table.sheet) {
      const refs = row.cells
        .filter((c): c is ParsedCell => typeof c !== 'string' && !!c.ref)
        .map((c) => c.ref);
      if (refs.length) regions = [{ sheet: table.sheet, range: `${refs[0]}:${refs[refs.length - 1]}` }];
    }
    out.push({
      page: table.page ?? null,
      sheet: table.sheet ?? null,
      headingPath: table.title ? [table.title] : [],
      tableIndex,
      rowIndex: row.rowIndex,
      kind: 'TABLE_ROW',
      text: `${table.title ?? 'Table'}${loc}${headerLine ? '\n' + headerLine : ''}\nRow ${row.rowIndex + 1}:\n${pairs}`,
      regions,
    });
  }
  return out;
}
