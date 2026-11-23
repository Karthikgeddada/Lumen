// API client: access token in memory; refresh token via httpOnly cookie
// (sameSite=none, sent automatically with credentials:'include') with the
// localStorage copy as fallback for browsers that block third-party cookies.

// Same-origin mode: NEXT_PUBLIC_API_URL=same-origin makes all API calls relative
// ("/api/...") — the server hosting the frontend proxies them to the backend via
// the next.config.mjs rewrites. Used by the Databricks App single-container deploy.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL === 'same-origin' ? '' : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

const RT_KEY = 'lumen.rt';
function setRefreshToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(RT_KEY, token);
  else localStorage.removeItem(RT_KEY);
}

export function storeTokens(tokens: { accessToken: string; refreshToken?: string }) {
  setAccessToken(tokens.accessToken);
  if (tokens.refreshToken) setRefreshToken(tokens.refreshToken);
}

export function clearTokens() {
  setAccessToken(null);
  setRefreshToken(null);
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const rt = typeof window !== 'undefined' ? localStorage.getItem(RT_KEY) : null;
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rt ? { refreshToken: rt } : {}),
        });
        if (!res.ok) return false;
        const data = await res.json();
        storeTokens(data);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 50);
      }
    })();
  }
  return refreshing;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const call = () =>
    fetch(`${API_BASE}${path}`, {
      ...opts,
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...opts.headers,
      },
      body: opts.body instanceof FormData ? opts.body : opts.body != null ? JSON.stringify(opts.body) : undefined,
    });

  let res = await call();

  // One silent refresh-and-retry per request on 401. /api/auth/me is
  // deliberately INCLUDED: on a hard page reload the in-memory access token
  // is gone, so the boot-time /me call is exactly what must trigger the
  // silent refresh — excluding it made every page reload bounce the user
  // back to sign-in. Only the credential-bearing endpoints themselves
  // (signin/refresh/register/signout) are exempt, to avoid rotation loops.
  const refreshExempt =
    path.startsWith('/api/auth/') &&
    path !== '/api/auth/me';
  if (res.status === 401 && !refreshExempt) {
    const ok = await tryRefresh();
    if (ok) res = await call();
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
    return (await res.blob()) as unknown as T;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Backend error shape: { error: { code, message, details } } — also accept
    // the flat { code, message } shape just in case.
    const err = data?.error ?? data;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

// SSE streaming with auth: fetch + ReadableStream (EventSource cannot send headers).
export async function streamSSE(
  path: string,
  body: unknown,
  onEvent: (event: { delta?: string; done?: boolean; message?: unknown; error?: string }) => void,
): Promise<void> {
  const call = () =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

  let res = await call();
  if (res.status === 401) {
    const ok = await tryRefresh();
    if (ok) res = await call();
  }
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error?.message ?? data?.message) message = data?.error?.message ?? data?.message;
    } catch {}
    throw new ApiError(res.status, 'STREAM_ERROR', message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}
