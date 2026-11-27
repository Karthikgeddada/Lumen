// Dependency rules for the analytics module (docs/ANALYTICS_MODULE.md has the
// rationale). This is a static source scan: it reads every non-test .ts file
// under backend/src and fails on any import that breaks the layering:
//
//   core        pure — no prisma, express, env/config, logger, middleware,
//               utils, services or routes imports, and no upward ('..') imports
//   services    never imports routes (its own module's or another's)
//   routes      never imports another module's routes (src/routes)
//   outsiders   (src/routes, src/services, worker, index) may touch analytics
//               ONLY via the barrel ('../analytics') or analytics/core —
//               except routes/mounts.ts, whose whole job is wiring mounts
//
// See docs/ARCHITECTURE.md "Backend module conventions".

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..'); // backend/src

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

function specifiers(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

const files = walk(SRC);
const rel = (f: string) => relative(SRC, f).split('\\').join('/');

describe('analytics module dependency rules', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('core is pure: no prisma/express/env/services/routes/middleware and no upward imports', () => {
    const forbidden = ['@prisma', 'prisma', 'express', 'services', 'routes', 'middleware', 'config', 'logger', 'utils', '..'];
    for (const f of files) {
      if (!rel(f).startsWith('analytics/core/')) continue;
      for (const spec of specifiers(f)) {
        for (const bad of forbidden) {
          expect(spec, `${rel(f)} imports '${spec}' — core must stay pure`).not.toContain(bad);
        }
      }
    }
  });

  it('analytics/services never imports routes', () => {
    for (const f of files) {
      if (!rel(f).startsWith('analytics/services/')) continue;
      for (const spec of specifiers(f)) {
        expect(spec, `${rel(f)} imports '${spec}' — services must not import routes`).not.toContain('routes');
      }
    }
  });

  it("analytics/routes never imports another module's routes (src/routes)", () => {
    for (const f of files) {
      if (!rel(f).startsWith('analytics/routes/')) continue;
      for (const spec of specifiers(f)) {
        expect(
          spec.includes('../routes') || spec.includes('../../routes'),
          `${rel(f)} imports '${spec}' — a module's routes must not import another module's routes`,
        ).toBe(false);
      }
    }
  });

  it("src/routes never imports another module's routes (analytics/routes)", () => {
    for (const f of files) {
      const r = rel(f);
      if (!r.startsWith('routes/') || r === 'routes/mounts.ts') continue; // mounts.ts IS the wiring
      for (const spec of specifiers(f)) {
        expect(
          spec.includes('analytics/routes'),
          `${r} imports '${spec}' — use analytics/index, analytics/core, or extend routes/mounts.ts`,
        ).toBe(false);
      }
    }
  });

  it('outsiders touch analytics only via the barrel or analytics/core', () => {
    for (const f of files) {
      const r = rel(f);
      if (r.startsWith('analytics/')) continue; // insiders
      // The mount wiring is the sanctioned exception — it must reach the routers.
      if (r === 'routes/mounts.ts') continue;
      for (const spec of specifiers(f)) {
        if (!spec.includes('analytics')) continue;
        const ok = /(^|\/)analytics$/.test(spec) || spec.includes('/analytics/core/');
        expect(
          ok,
          `${r} imports '${spec}' — outsiders use analytics/index (the barrel) or analytics/core, never analytics/services or analytics/routes`,
        ).toBe(true);
      }
    }
  });
});
