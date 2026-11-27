// Borrower quarterly reporting package.
//
// Default package definition (agreed with the user): a borrower's package is
// the set of document kinds its monitoring requires, seeded with three
// standard items. An item counts as RECEIVED for a quarter when any document
// tagged to the borrower whose name matches one of the item's keywords
// arrived (uploaded or emailed) inside that quarter's window.

import { prisma } from '../prisma';

export const DEFAULT_PACKAGE_ITEMS = [
  {
    label: 'Financial statements',
    keywords: 'financial statement,balance sheet,income statement,profit and loss,p&l,10-k,10-q,annual report,interim report',
  },
  {
    label: 'Compliance certificate',
    keywords: 'compliance certificate,covenant certificate,compliance report,covenant report',
  },
  {
    label: 'Borrowing base certificate',
    keywords: 'borrowing base,borrowing base certificate',
  },
];

// Seed the default items once per borrower — no-op when items already exist
// (including the zero-item case the user created deliberately).
export async function seedPackageItems(entityId: string): Promise<void> {
  const existing = await prisma.packageItem.count({ where: { entityId } });
  if (existing > 0) return;
  await prisma.packageItem.createMany({
    data: DEFAULT_PACKAGE_ITEMS.map((i) => ({ ...i, entityId })),
  });
}

// "Q3 2026" → [2026-07-01, 2026-10-01); "2026" → the full year. Returns null
// for labels it cannot parse (those quarters simply never match).
export function quarterWindow(period: string): { start: Date; end: Date } | null {
  const q = period.trim().toUpperCase().match(/^Q([1-4])\s?(\d{4})$/);
  if (q) {
    const startMonth = (parseInt(q[1], 10) - 1) * 3;
    const year = parseInt(q[2], 10);
    return { start: new Date(Date.UTC(year, startMonth, 1)), end: new Date(Date.UTC(year, startMonth + 3, 1)) };
  }
  const y = period.trim().match(/^(\d{4})$/);
  if (y) {
    const year = parseInt(y[1], 10);
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  }
  return null;
}

// The last n quarters as "Qn YYYY" labels, oldest first, ending with the
// quarter containing today (UTC).
export function lastNQuarters(n: number): string[] {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const year = now.getUTCFullYear();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let qq = q - i;
    let yy = year;
    while (qq <= 0) { qq += 4; yy -= 1; }
    out.push(`Q${qq} ${yy}`);
  }
  return out;
}

export type PackageStatus = 'RECEIVED' | 'MISSING';

export async function computePackage(entityId: string, periods: string[]) {
  const [items, docs] = await Promise.all([
    prisma.packageItem.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
    prisma.document.findMany({
      where: { entityId, deletedAt: null, status: { notIn: ['FAILED', 'UPLOADING'] } },
      select: { id: true, name: true, uploadedAt: true, emailReceivedAt: true },
    }),
  ]);

  const quarters = periods.map((period) => {
    const w = quarterWindow(period);
    const cells = items.map((item) => {
      if (!w) return { itemId: item.id, status: 'MISSING' as PackageStatus, documentId: null, documentName: null, receivedAt: null };
      const keywords = item.keywords.toLowerCase().split(',').map((k) => k.trim()).filter(Boolean);
      const hit = docs.find((d) => {
        const arrived = d.emailReceivedAt ?? d.uploadedAt;
        if (arrived < w.start || arrived >= w.end) return false;
        const name = d.name.toLowerCase();
        return keywords.some((k) => name.includes(k));
      });
      return hit
        ? { itemId: item.id, status: 'RECEIVED' as PackageStatus, documentId: hit.id, documentName: hit.name, receivedAt: (hit.emailReceivedAt ?? hit.uploadedAt).toISOString() }
        : { itemId: item.id, status: 'MISSING' as PackageStatus, documentId: null, documentName: null, receivedAt: null };
    });
    return { period, cells };
  });

  return {
    items: items.map(({ id, label, keywords, required }) => ({ id, label, keywords, required })),
    quarters,
  };
}
