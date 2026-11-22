import { prisma } from '../prisma';
import { logger } from '../logger';
import { chatJson, hasAI, aiUnavailableMessage } from './ai';
import { retrieve, buildContext, RetrievedChunk, ANTI_INJECTION_RULES } from './rag';

// Structured field extraction, grounded in retrieved evidence. Every result
// carries its confidence, source document, page/sheet/cell pointer and an
// evidence excerpt. Confidence is a signal for reviewers — never proof of
// correctness — so results stay NEEDS_REVIEW until a human verifies them.

export type FieldSpec = { key: string; label: string; type: string; description?: string };

export async function runExtraction(taskId: string): Promise<void> {
  const task = await prisma.extractionTask.findUnique({
    where: { id: taskId },
    include: { fields: { orderBy: { order: 'asc' } } },
  });
  if (!task || task.deletedAt) return;

  if (!hasAI()) {
    await prisma.extractionTask.update({
      where: { id: taskId },
      data: { status: 'FAILED', error: aiUnavailableMessage() },
    });
    return;
  }

  await prisma.extractionTask.update({ where: { id: taskId }, data: { status: 'RUNNING', error: null } });

  const documentIds = (task.documentIds as string[]) || [];
  try {
    for (const field of task.fields) {
      // Previous results for this field are replaced on re-run.
      await prisma.extractionResult.deleteMany({ where: { taskId, fieldId: field.id } });

      for (const documentId of documentIds) {
        const doc = await prisma.document.findFirst({
          where: { id: documentId, workspaceId: task.workspaceId, deletedAt: null, status: 'COMPLETED' },
          select: { id: true, name: true },
        });
        if (!doc) continue;

        const chunks = await retrieve(
          task.workspaceId,
          { documentIds: [documentId] },
          `${field.label} ${field.description ?? ''}`,
          6,
        );

        let value: string | null = null;
        let unit: string | null = null;
        let confidence = 0;
        let evidence: RetrievedChunk | null = null;

        if (chunks.length > 0) {
          const res = await chatJson<{
            value: string | null;
            unit?: string | null;
            confidence?: number;
            evidence?: number[];
          }>([
            {
              role: 'system',
              content: `${ANTI_INJECTION_RULES}\n\nYou extract a single structured field from document evidence. Respond with JSON: {"value": string|null, "unit": string|null, "confidence": number 0-1, "evidence": [block numbers]}. Set value to null when the evidence does not contain the field. Confidence reflects how directly the evidence states the value — never inflate it.`,
            },
            {
              role: 'user',
              content: `Field: ${field.label}${field.description ? ` — ${field.description}` : ''}\nType: ${field.type}\n\nEvidence:\n${buildContext(chunks)}`,
            },
          ]);
          if (res) {
            value = res.value ?? null;
            unit = res.unit ?? null;
            confidence = Math.max(0, Math.min(1, Number(res.confidence ?? 0)));
            const n = Array.isArray(res.evidence) ? res.evidence[0] : undefined;
            if (typeof n === 'number' && n >= 1 && n <= chunks.length) evidence = chunks[n - 1];
          }
        }

        // A cell reference, when the evidence lives in a spreadsheet table row
        const cellMatch = evidence?.text.match(/\(([A-Z]{1,3}\d{1,5})\)/);

        await prisma.extractionResult.create({
          data: {
            taskId,
            fieldId: field.id,
            documentId,
            value,
            unit,
            confidence,
            page: evidence?.page ?? null,
            sheet: evidence?.sheet ?? null,
            cell: cellMatch ? cellMatch[1] : null,
            excerpt: evidence ? evidence.text.slice(0, 1200) : null,
            status: value != null && evidence ? 'NEEDS_REVIEW' : 'MISSING',
          },
        });
      }
    }

    await prisma.extractionTask.update({
      where: { id: taskId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed';
    await prisma.extractionTask.update({ where: { id: taskId }, data: { status: 'FAILED', error: message } });
    logger.error({ err, taskId }, 'extraction failed');
    throw err;
  }
}

// AI-suggested fields grounded in a document's actual headings and tables.
export async function suggestFields(workspaceId: string, documentId: string): Promise<FieldSpec[]> {
  if (!hasAI()) throw new Error(aiUnavailableMessage());

  const headings = await prisma.documentSection.findMany({
    where: { documentId, kind: 'HEADING' },
    orderBy: { order: 'asc' },
    take: 120,
    select: { text: true },
  });
  const tables = await prisma.documentTable.findMany({
    where: { documentId },
    take: 30,
    select: { title: true, sheet: true, header: true },
  });
  const tableHint = tables
    .map((t) => `${t.title ?? ''}${t.sheet ? ` (sheet ${t.sheet})` : ''}: ${((t.header as string[]) ?? []).join(' | ')}`)
    .join('\n');

  const res = await chatJson<{ fields: FieldSpec[] }>([
    {
      role: 'system',
      content:
        'You propose structured extraction fields for business documents. Only propose fields the document structure actually supports (headings, table columns). Respond with JSON {"fields":[{"key":"snake_case","label":"…","type":"text|number|currency|percent|date","description":"…"}]}. Max 12 fields.',
    },
    {
      role: 'user',
      content: `Document headings:\n${headings.map((h) => h.text).join('\n')}\n\nTables:\n${tableHint || '(none)'}`,
    },
  ]);
  return (res?.fields ?? []).slice(0, 12).filter((f) => f.key && f.label);
}
