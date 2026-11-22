import type { ParsedDoc, ParsedTable, ParsedSection } from './parsers';

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
    out.push({
      page: current.page,
      sheet: null,
      headingPath: path,
      kind: current.parts.some((p) => p.kind === 'FOOTNOTE') ? 'FOOTNOTE' : 'PARAGRAPH',
      text: label + body,
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
    out.push({
      page: table.page ?? null,
      sheet: table.sheet ?? null,
      headingPath: table.title ? [table.title] : [],
      tableIndex,
      rowIndex: row.rowIndex,
      kind: 'TABLE_ROW',
      text: `${table.title ?? 'Table'}${loc}${headerLine ? '\n' + headerLine : ''}\nRow ${row.rowIndex + 1}:\n${pairs}`,
    });
  }
  return out;
}
