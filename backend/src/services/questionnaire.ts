import * as XLSX from 'xlsx';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { chatJson, hasAI, aiUnavailableMessage } from './ai';
import { retrieve, buildContext, RetrievedChunk, ANTI_INJECTION_RULES } from './rag';

// Questionnaires: Excel import, AI-drafted answers with evidence, review
// workflow and export. AI answers are drafts until a human approves them —
// never automatically presented as verified.

export type WorkspaceRules = {
  requireCitations: boolean; // default true — draft answers without evidence are rejected
  lowConfidenceThreshold: number; // default 0.85 — below this, answers are flagged for review
  autoApproveHighConfidence: boolean; // default false — must be explicitly enabled by an admin
};

export const DEFAULT_RULES: WorkspaceRules = {
  requireCitations: true,
  lowConfidenceThreshold: 0.85,
  autoApproveHighConfidence: false,
};

export async function getRules(workspaceId: string): Promise<WorkspaceRules> {
  const row = await prisma.workspaceSetting.findUnique({
    where: { workspaceId_key: { workspaceId, key: 'questionnaires.rules' } },
  });
  if (!row) return DEFAULT_RULES;
  return { ...DEFAULT_RULES, ...(row.value as Partial<WorkspaceRules>) };
}

// ── Excel import ────────────────────────────────────────────────────────
// Expected columns (case-insensitive, order-free): Section | Question |
// Type | Options | Required. A header row is detected automatically.
export function questionsFromWorkbook(buffer: Buffer): {
  section: string;
  type: string;
  prompt: string;
  options: string[] | null;
  required: boolean;
}[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

  const out: ReturnType<typeof questionsFromWorkbook> = [];
  for (const row of rows) {
    const entry = Object.entries(row).map(([k, v]) => [norm(k), String(v ?? '').trim()] as const);
    const get = (...names: string[]) => entry.find(([k]) => names.includes(k))?.[1] ?? '';

    const prompt = get('question', 'prompt', 'q');
    if (!prompt || /^(question|prompt)$/i.test(prompt)) continue; // header row

    const rawType = get('type').toLowerCase();
    const type = rawType.includes('yes')
      ? 'yes_no'
      : rawType.includes('choice') || rawType.includes('multi')
        ? 'multiple_choice'
        : rawType.includes('table')
          ? 'table'
          : 'text';
    const optionsRaw = get('options', 'choices');
    const options = optionsRaw
      ? optionsRaw.split(/[;|]/).map((o) => o.trim()).filter(Boolean)
      : null;

    out.push({
      section: get('section', 'category') || 'General',
      type,
      prompt,
      options: type === 'multiple_choice' && options ? options : null,
      required: get('required').toLowerCase() !== 'no',
    });
  }
  return out.slice(0, 500);
}

// ── AI drafting ─────────────────────────────────────────────────────────
export async function draftQuestionnaire(questionnaireId: string): Promise<void> {
  const q = await prisma.questionnaire.findUnique({
    where: { id: questionnaireId },
    include: { questions: { orderBy: { order: 'asc' }, include: { answer: true } } },
  });
  if (!q || q.deletedAt) return;

  if (!hasAI()) throw new Error(aiUnavailableMessage());
  const rules = await getRules(q.workspaceId);

  for (const question of q.questions) {
    // Skip questions a reviewer has already approved or rejected.
    if (question.answer && ['APPROVED', 'REJECTED'].includes(question.answer.status)) continue;

    // Answer only from the documents this questionnaire is scoped to
    // (picked from the data room); empty scope = all workspace documents.
    const docIds = (q.documentIds as string[] | null) ?? [];
    const scope = docIds.length ? { documentIds: docIds } : {};
    const chunks: RetrievedChunk[] = await retrieve(
      q.workspaceId,
      scope,
      question.prompt,
      5,
    );

    let draft: string | null = null;
    let confidence = 0;
    let evidenceChunk: RetrievedChunk | null = null;

    if (chunks.length) {
      const res = await chatJson<{
        answer: string | null;
        confidence?: number;
        evidence?: number[];
      }>([
        {
          role: 'system',
          content: `${ANTI_INJECTION_RULES}\n\nYou draft an answer to a vendor-assessment question from the organization's document evidence. Respond with JSON {"answer": string|null, "confidence": 0-1, "evidence": [block numbers]}. Answer null when the evidence does not address the question. For yes/no questions answer exactly "Yes" or "No". Keep prose answers under 80 words.`,
        },
        {
          role: 'user',
          content: `Question: ${question.prompt}\n${Array.isArray(question.options) ? `Allowed choices: ${question.options.join(' / ')}` : ''}\n\nEvidence:\n${buildContext(chunks)}`,
        },
      ]);
      if (res) {
        draft = res.answer ?? null;
        confidence = Math.max(0, Math.min(1, Number(res.confidence ?? 0)));
        const n = Array.isArray(res.evidence) ? res.evidence[0] : undefined;
        if (typeof n === 'number' && n >= 1 && n <= chunks.length) evidenceChunk = chunks[n - 1];
      }
    }

    const hasEvidence = Boolean(evidenceChunk);
    const missingEvidence = rules.requireCitations && !hasEvidence;
    const lowConfidence = confidence < rules.lowConfidenceThreshold;
    const autoApproved =
      rules.autoApproveHighConfidence && confidence >= 0.98 && hasEvidence && !missingEvidence;

    let status: 'MISSING' | 'NEEDS_REVIEW' | 'AI_DRAFTED' | 'APPROVED';
    if (!draft || missingEvidence) status = 'MISSING';
    else if (autoApproved) status = 'APPROVED';
    else if (lowConfidence) status = 'NEEDS_REVIEW';
    else status = 'AI_DRAFTED';

    await prisma.questionAnswer.upsert({
      where: { questionId: question.id },
      create: {
        questionId: question.id,
        draftAnswer: draft,
        confidence,
        status,
      },
      update: {
        draftAnswer: draft,
        confidence,
        status,
        comment: status === 'MISSING' ? 'No supporting evidence found in workspace documents.' : undefined,
      },
    });

    if (evidenceChunk && status !== 'MISSING') {
      const answer = await prisma.questionAnswer.findUnique({ where: { questionId: question.id } });
      if (answer) {
        await prisma.answerEvidence.deleteMany({ where: { answerId: answer.id } });
        await prisma.answerEvidence.create({
          data: {
            answerId: answer.id,
            documentId: evidenceChunk.documentId,
            page: evidenceChunk.page,
            kind: evidenceChunk.kind as never,
            tableRef: evidenceChunk.sheet ? `Sheet ${evidenceChunk.sheet}` : evidenceChunk.page != null ? `Page ${evidenceChunk.page}` : null,
            excerpt: evidenceChunk.text.slice(0, 1200),
          },
        });
      }
    }
  }

  logger.info({ questionnaireId }, 'questionnaire drafting complete');
}

// ── Export (preserves section structure; one row per question) ───────────
export function questionnaireToWorkbook(q: {
  title: string;
  questions: {
    section: string;
    order: number;
    prompt: string;
    answer: { draftAnswer: string | null; finalAnswer: string | null; status: string; confidence: number | null } | null;
  }[];
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows: (string | number)[][] = [
    ['Section', '#', 'Question', 'Answer', 'Status', 'Confidence'],
  ];
  for (const question of q.questions) {
    const a = question.answer;
    rows.push([
      question.section,
      question.order + 1,
      question.prompt,
      a?.finalAnswer ?? a?.draftAnswer ?? '',
      a?.status ?? 'MISSING',
      a?.confidence != null ? Math.round(a.confidence * 100) : '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 5 }, { wch: 70 }, { wch: 50 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, q.title.slice(0, 31) || 'Questionnaire');
  return wb;
}
