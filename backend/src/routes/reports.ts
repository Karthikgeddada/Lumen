// Quarterly covenant reports + audit exports (page spec: Reports). The JSON
// preview and the XLSX download are generated from the same assembled
// payload, so the file can never disagree with the screen. Every figure
// carries its sources and flags (derivation, confidence, unresolved scale).

import { Router } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ApiError, asyncH } from '../middleware/error';
import { requireAuth, requireWorkspace } from '../middleware/auth';
import { audit } from '../utils';
import { computePackage, lastNQuarters } from '../services/borrowers';
import { scaleUnresolved } from '../services/trust';

const router = Router({ mergeParams: true }); // routes carry :workspaceId themselves; mounted at /api

const MAX_QUARTERS = 12;

// Assemble the quarterly covenant report for one company: package status,
// covenant results per period, and the underlying figures with provenance.
async function covenantReport(workspaceId: string, entityId: string, quarters: number) {
  const entity = await prisma.entity.findFirst({
    where: { id: entityId, workspaceId },
    select: { id: true, name: true, parentId: true },
  });
  if (!entity) throw new ApiError(404, 'NOT_FOUND', 'Company not found.');

  const periods = lastNQuarters(quarters); // oldest → newest

  const [pkg, definitions, figures] = await Promise.all([
    computePackage(entityId, periods),
    prisma.covenantDefinition.findMany({
      where: { entityId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { results: { where: { period: { in: periods } }, orderBy: { period: 'desc' } } },
    }),
    prisma.metricObservation.findMany({
      where: { entityId, period: { in: periods } },
      orderBy: [{ metricKey: 'asc' }, { period: 'desc' }],
      take: 500,
    }),
  ]);

  const covenants = definitions.map((d) => ({
    id: d.id,
    label: d.label,
    key: d.key,
    comparator: d.comparator,
    threshold: d.threshold,
    unit: d.unit,
    nearBreachPct: d.nearBreachPct,
    results: d.results.map((r) => ({
      period: r.period, status: r.status, value: r.value, headroom: r.headroom,
      nearBreach: r.nearBreach, reason: r.reason, previousStatus: r.previousStatus,
    })),
  }));

  const figureRows = figures.map((o) => ({
    metricKey: o.metricKey,
    label: o.label,
    period: o.period,
    value: o.value,
    unit: o.unit,
    derivation: o.derivation,
    confidence: o.confidence,
    sourceDocumentId: o.sourceDocumentId,
    sourcePage: o.sourcePage,
    sourceExcerpt: o.sourceExcerpt,
    // TRUST: a figure whose unit scale is still unresolved is flagged, not
    // silently shipped — the report must disclose it.
    scaleUnresolved: scaleUnresolved(o.scale as unknown),
  }));

  return {
    entity,
    periods: [...periods].reverse(), // newest first for display
    generatedAt: new Date().toISOString(),
    package: pkg,
    covenants,
    figures: figureRows,
  };
}

// JSON preview — what the frontend renders and the print/PDF view uses.
router.get(
  '/workspaces/:workspaceId/reports/covenant',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const q = z
      .object({ entityId: z.string().min(1), quarters: z.coerce.number().int().min(1).max(MAX_QUARTERS).default(4) })
      .parse(req.query);
    const report = await covenantReport(req.ws!.id, q.entityId, q.quarters);
    res.json({ report });
  }),
);

// XLSX download — same payload as the preview, one sheet per section.
router.get(
  '/workspaces/:workspaceId/reports/covenant.xlsx',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const q = z
      .object({ entityId: z.string().min(1), quarters: z.coerce.number().int().min(1).max(MAX_QUARTERS).default(4) })
      .parse(req.query);
    const report = await covenantReport(req.ws!.id, q.entityId, q.quarters);

    const wb = XLSX.utils.book_new();

    // Summary sheet: entity, period window, package grid, covenant roll-up.
    const latest = report.periods[0] ?? '';
    const latestResults = report.covenants.map((c) => c.results.find((r) => r.period === latest) ?? c.results[0] ?? null);
    const summary: (string | number)[][] = [
      ['Quarterly covenant report'],
      ['Company', report.entity.name],
      ['Period', latest],
      ['Window', `${report.periods[report.periods.length - 1] ?? ''} – ${latest}`],
      ['Generated', new Date(report.generatedAt).toISOString()],
      [],
      ['Covenant', 'Latest status', 'Value', 'Threshold', 'Unit', 'Headroom'],
      ...report.covenants.map((c, i) => [
        c.label,
        latestResults[i]?.status ?? 'NOT_TESTED',
        latestResults[i]?.value ?? '',
        `${c.comparator === 'LTE' ? '≤' : '≥'} ${c.threshold}`,
        c.unit,
        latestResults[i]?.headroom ?? '',
      ]),
      [],
      ['Quarterly package'],
      ...pkgSheetRows(report),
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Covenants sheet: one row per covenant × period with previous status.
    const covRows: (string | number)[][] = [['Covenant', 'Period', 'Status', 'Value', 'Headroom', 'Threshold', 'Unit', 'Previous status', 'Reason']];
    for (const c of report.covenants) {
      for (const r of c.results) {
        covRows.push([c.label, r.period, r.status, r.value ?? '', r.headroom ?? '', c.threshold, c.unit, r.previousStatus ?? '', r.reason ?? '']);
      }
      if (!c.results.length) covRows.push([c.label, '', 'NOT_TESTED', '', '', c.threshold, c.unit, '', '']);
    }
    const wsCov = XLSX.utils.aoa_to_sheet(covRows);
    wsCov['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsCov, 'Covenants');

    // Figures sheet: sources and flags for every underlying number.
    const figRows: (string | number)[][] = [
      ['Figure', 'Key', 'Period', 'Value', 'Unit', 'Derivation', 'Confidence', 'Scale flag', 'Source page', 'Source excerpt'],
    ];
    for (const f of report.figures) {
      figRows.push([
        f.label, f.metricKey, f.period, f.value, f.unit, f.derivation,
        f.confidence != null ? Math.round(f.confidence * 100) : '',
        f.scaleUnresolved ? 'UNRESOLVED SCALE' : '',
        f.sourcePage ?? '',
        f.sourceExcerpt ?? '',
      ]);
    }
    const wsFig = XLSX.utils.aoa_to_sheet(figRows);
    wsFig['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsFig, 'Figures');

    const safeName = report.entity.name.replace(/["\\/]/g, '');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-covenant-report-${latest.replace(/\s/g, '')}.xlsx"`);
    res.send(buf);
    await audit({
      workspaceId: req.ws!.id, actorId: req.auth!.userId, action: 'report.exported',
      targetType: 'entity', targetId: report.entity.id, meta: { kind: 'covenant', period: latest },
    });
  }),
);

// Package rows helper — latest period's expected vs received per item.
function pkgSheetRows(report: Awaited<ReturnType<typeof covenantReport>>): (string | number)[][] {
  const rows: (string | number)[][] = [['Item', 'Status', 'Period', 'Source document']];
  const latest = report.periods[0];
  const quarter = report.package.quarters.find((qq) => qq.period === latest);
  if (quarter) {
    quarter.cells.forEach((cell, i) => {
      rows.push([
        report.package.items[i]?.label ?? cell.itemId,
        cell.status,
        quarter.period,
        cell.documentName ?? '',
      ]);
    });
  }
  return rows;
}

// Audit export — the workspace's activity trail for a date range (default
// trailing 90 days), one row per event.
router.get(
  '/workspaces/:workspaceId/reports/audit.xlsx',
  requireAuth,
  requireWorkspace('VIEWER'),
  asyncH(async (req, res) => {
    const wid = req.ws!.id;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 90 * 86400e3);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(400, 'BAD_REQUEST', 'Invalid date range.');
    }

    const events = await prisma.auditEvent.findMany({
      where: { workspaceId: wid, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: { actor: { select: { firstName: true, lastName: true, email: true } } },
    });

    const rows: (string | number)[][] = [['Date', 'Action', 'Actor', 'Target', 'Target ID', 'IP', 'Details']];
    for (const ev of events) {
      rows.push([
        ev.createdAt.toISOString(),
        ev.action,
        ev.actor ? `${ev.actor.firstName} ${ev.actor.lastName} (${ev.actor.email})` : 'System',
        ev.targetType ?? '',
        ev.targetId ?? '',
        ev.ip ?? '',
        ev.meta ? JSON.stringify(ev.meta) : '',
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 34 }, { wch: 20 }, { wch: 26 }, { wch: 16 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
    await audit({
      workspaceId: wid, actorId: req.auth!.userId, action: 'report.exported',
      targetType: 'workspace', targetId: wid, meta: { kind: 'audit', from: from.toISOString(), to: to.toISOString() },
    });
  }),
);

export default router;
