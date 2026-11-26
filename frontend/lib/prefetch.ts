'use client';

// Instant-feel navigation: when the user hovers (or touches) a nav item,
// start fetching that page's first-paint data into the SWR cache. By the
// time the click lands, the page mounts with data already present — no
// loading block. Keys below must EXACTLY match each page's useSWR keys.

import { preload } from 'swr';
import { api, qs } from './api';

const done = new Set<string>();

type Target = { key: string; fetch: () => Promise<unknown> };

export function prefetchRoute(href: string, wid?: string): void {
  if (!wid) return;
  const route = href.split('?')[0];
  const W = `/api/workspaces/${wid}`;
  const defaultDocs = qs({ q: '', collectionId: '', status: '', sort: 'uploadedAt' });

  let targets: Target[] = [];
  if (route === '/dashboard') {
    targets = [{ key: `${W}/dashboard`, fetch: () => api(`${W}/dashboard`) }];
  } else if (route === '/library') {
    targets = [
      { key: `${W}/documents${defaultDocs}`, fetch: () => api(`${W}/documents${defaultDocs}`) },
      { key: `${W}/collections`, fetch: () => api(`${W}/collections`) },
    ];
  } else if (route === '/assistant') {
    targets = [
      { key: `/api/${wid}/conversations`, fetch: () => api(`${W}/conversations`) },
      { key: `docs-${wid}`, fetch: () => api(`${W}/documents?status=COMPLETED&take=200`) },
      { key: `colls-${wid}`, fetch: () => api(`${W}/collections`) },
    ];
  } else if (route === '/extraction') {
    targets = [{ key: `ext-${wid}`, fetch: () => api(`${W}/extractions`) }];
  } else if (route === '/questionnaires') {
    targets = [
      { key: `q-${wid}`, fetch: () => api(`${W}/questionnaires`) },
      { key: `qdocs-${wid}`, fetch: () => api(`${W}/documents?status=COMPLETED&take=200`) },
    ];
  } else if (route === '/analytics') {
    targets = [{ key: `ent-${wid}`, fetch: () => api(`/api/${wid}/analytics/entities`) }];
  } else if (route === '/covenants') {
    targets = [
      { key: `ent-${wid}`, fetch: () => api(`/api/${wid}/analytics/entities`) },
      { key: `cov-${wid}-all`, fetch: () => api(`${W}/covenants`) },
    ];
  } else if (route === '/quality') {
    targets = [{ key: `qual-${wid}`, fetch: () => api(`${W}/quality`) }];
  } else if (route === '/team') {
    targets = [
      { key: `ws-${wid}`, fetch: () => api(W) },
      { key: `mem-${wid}`, fetch: () => api(`${W}/members`) },
      { key: `act-${wid}`, fetch: () => api(`${W}/activity`) },
    ];
  } else if (route === '/settings') {
    targets = [{ key: `wsd-${wid}`, fetch: () => api(W) }];
  }

  for (const t of targets) {
    if (done.has(t.key)) continue; // fetch each key once per session
    done.add(t.key);
    preload(t.key, t.fetch);
  }
}