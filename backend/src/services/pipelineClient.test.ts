import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapSidecarResponse, parseViaSidecar, sidecarEnv, sidecarSupported, type SidecarEnv } from './pipelineClient';

// Sidecar contract: one precedence order for scales, strict mapping, and a
// documented fallback reason for every failure mode — uploads never fail
// because the Python service is down.

const env: SidecarEnv = { url: 'http://sidecar', token: 'tok', timeoutMs: 5000 };

const validPayload = {
  pageCount: 3,
  ocrRequired: false,
  sections: [
    { kind: 'HEADING', level: 1, headingPath: ['CONDENSED CONSOLIDATED BALANCE SHEETS'], page: 1, order: 0, text: 'CONDENSED CONSOLIDATED BALANCE SHEETS' },
    { kind: 'PARAGRAPH', headingPath: ['CONDENSED CONSOLIDATED BALANCE SHEETS'], page: 1, order: 1, text: '(In thousands, except per share data)' },
  ],
  tables: [
    {
      page: 1,
      order: 0,
      title: '(In thousands, except per share data)',
      sheet: null,
      header: ['', 'December 31, 2025', 'December 31, 2024'],
      rows: [
        { rowIndex: 0, cells: ['Cash and cash equivalents', '1,204', '980'] },
        { rowIndex: 1, cells: ['Total current assets', '12,655', '11,430'] },
      ],
    },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sidecarEnv', () => {
  it('is null when PARSE_SERVICE_URL is unset (JS parsers only)', () => {
    vi.stubEnv('PARSE_SERVICE_URL', '');
    expect(sidecarEnv()).toBeNull();
  });

  it('reads url + token and trims a trailing slash', () => {
    vi.stubEnv('PARSE_SERVICE_URL', 'https://lumen-pipelines.onrender.com/');
    vi.stubEnv('PIPELINES_TOKEN', ' tok ');
    const e = sidecarEnv();
    expect(e?.url).toBe('https://lumen-pipelines.onrender.com');
    expect(e?.token).toBe('tok');
    expect(e?.timeoutMs).toBe(120000);
  });

  it('honours PARSE_TIMEOUT_MS and rejects bad values', () => {
    vi.stubEnv('PARSE_SERVICE_URL', 'http://x');
    vi.stubEnv('PARSE_TIMEOUT_MS', '5000');
    expect(sidecarEnv()?.timeoutMs).toBe(5000);
    vi.stubEnv('PARSE_TIMEOUT_MS', 'not-a-number');
    expect(sidecarEnv()?.timeoutMs).toBe(120000);
    vi.stubEnv('PARSE_TIMEOUT_MS', '10'); // below the 1s floor — rejected
    expect(sidecarEnv()?.timeoutMs).toBe(120000);
  });
});

describe('sidecarSupported', () => {
  it('sends the formats the sidecar parses best', () => {
    for (const ext of ['pdf', 'docx', 'xlsx', 'csv']) expect(sidecarSupported(ext)).toBe(true);
  });

  it('keeps legacy formats local (openpyxl/python-docx cannot read them)', () => {
    for (const ext of ['xls', 'doc', 'txt', '']) expect(sidecarSupported(ext)).toBe(false);
  });
});

describe('mapSidecarResponse', () => {
  it('maps a valid payload to ParsedDoc', () => {
    const doc = mapSidecarResponse(validPayload);
    expect(doc).not.toBeNull();
    expect(doc!.pageCount).toBe(3);
    expect(doc!.ocrRequired).toBe(false);
    expect(doc!.sections).toHaveLength(2);
    expect(doc!.tables).toHaveLength(1);
    expect(doc!.tables[0].header).toEqual(['', 'December 31, 2025', 'December 31, 2024']);
    expect(doc!.tables[0].rows[0].cells).toEqual(['Cash and cash equivalents', '1,204', '980']);
  });

  it('keeps formula cells with their refs and formulas (openpyxl provenance)', () => {
    const doc = mapSidecarResponse({
      pageCount: null,
      ocrRequired: false,
      sections: [],
      tables: [{ page: null, order: 0, title: 't', sheet: 'Q3', header: null, rows: [{ rowIndex: 0, cells: [{ v: '4820', ref: 'B7', f: '=SUM(B2:B6)' }, ''] }] }],
    });
    expect(doc?.tables[0].rows[0].cells[0]).toEqual({ v: '4820', ref: 'B7', f: '=SUM(B2:B6)' });
  });

  it('maps unknown kinds to PARAGRAPH (the sidecar emits HEADING/PARAGRAPH only)', () => {
    const doc = mapSidecarResponse({ ...validPayload, sections: [{ kind: 'WEIRD', headingPath: [], page: 2, order: 0, text: 'x' }] });
    expect(doc?.sections[0].kind).toBe('PARAGRAPH');
  });

  it('accepts null pageCount and null pages', () => {
    const doc = mapSidecarResponse({ ...validPayload, pageCount: null, tables: [{ ...validPayload.tables[0], page: null }] });
    expect(doc?.pageCount).toBeNull();
    expect(doc?.tables[0].page).toBeNull();
  });

  it('rejects payloads that violate the contract (fallback, never half-trusted)', () => {
    expect(mapSidecarResponse(null)).toBeNull();
    expect(mapSidecarResponse('ok')).toBeNull();
    expect(mapSidecarResponse({ pageCount: 1, tables: [] })).toBeNull(); // no sections
    expect(mapSidecarResponse({ ...validPayload, ocrRequired: 'no' })).toBeNull();
    expect(mapSidecarResponse({ ...validPayload, sections: [{ kind: 'HEADING', headingPath: [], page: 1, order: 0 }] })).toBeNull(); // no text
    expect(mapSidecarResponse({ ...validPayload, tables: [{ ...validPayload.tables[0], rows: 'nope' }] })).toBeNull();
    expect(mapSidecarResponse({ ...validPayload, tables: [{ ...validPayload.tables[0], rows: [{ rowIndex: 0, cells: [17] }] }] })).toBeNull(); // non-cell
    expect(mapSidecarResponse({ ...validPayload, sections: [{ ...validPayload.sections[1], headingPath: 'x' }] })).toBeNull();
  });
});

describe('parseViaSidecar', () => {
  it('returns the mapped doc on a 200, with token + filename sent correctly', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validPayload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await parseViaSidecar(env, new Uint8Array([1, 2, 3]), 'Acme Q3 10-K.pdf');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.doc.tables).toHaveLength(1);
    }
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://sidecar/parse?name=Acme%20Q3%2010-K.pdf');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Pipeline-Token']).toBe('tok');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('omits the token header entirely when none is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(validPayload), { status: 200 })));
    await parseViaSidecar({ ...env, token: '' }, new Uint8Array(), 'a.pdf');
    const [, init] = (vi.mocked(globalThis.fetch).mock.calls[0] as unknown as [string, RequestInit]);
    expect((init.headers as Record<string, string>)['X-Pipeline-Token']).toBeUndefined();
  });

  it('falls back with an HTTP reason on auth failure (401)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    const out = await parseViaSidecar(env, new Uint8Array(), 'a.pdf');
    expect(out).toEqual({ ok: false, reason: 'sidecar responded 401' });
  });

  it('falls back when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway error</html>', { status: 200 })));
    const out = await parseViaSidecar(env, new Uint8Array(), 'a.pdf');
    expect(out).toEqual({ ok: false, reason: 'sidecar returned invalid JSON' });
  });

  it('falls back when the JSON violates the contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 })));
    const out = await parseViaSidecar(env, new Uint8Array(), 'a.pdf');
    expect(out).toEqual({ ok: false, reason: 'sidecar payload did not match the parse contract' });
  });

  it('times out and falls back (free-tier cold start)', async () => {
    const hanging = (_u: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    vi.stubGlobal('fetch', vi.fn(hanging));
    const out = await parseViaSidecar({ ...env, timeoutMs: 20 }, new Uint8Array(), 'a.pdf');
    expect(out).toEqual({ ok: false, reason: 'sidecar timed out after 20 ms' });
  });

  it('falls back when fetch throws (service down)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    const out = await parseViaSidecar(env, new Uint8Array(), 'a.pdf');
    expect(out).toEqual({ ok: false, reason: 'sidecar unreachable' });
  });
});
