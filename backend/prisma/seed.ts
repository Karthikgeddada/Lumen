import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// Seed:
//  1. Built-in extraction templates (always, idempotent).
//  2. Optional demo workspace (SEED_DEMO=true) — reference demo content,
//     clearly marked isDemo everywhere. Demo documents have extracted content
//     for the viewer/assistant, but no original file (no S3 upload happens).

const prisma = new PrismaClient();

const BUILT_IN_TEMPLATES = [
  {
    name: 'Credit agreement',
    description: 'Key terms from facility and credit agreements.',
    fields: [
      { key: 'borrower', label: 'Borrower', type: 'text' },
      { key: 'lender', label: 'Lender / agent', type: 'text' },
      { key: 'facility_amount', label: 'Facility amount', type: 'currency' },
      { key: 'maturity_date', label: 'Maturity date', type: 'date' },
      { key: 'interest_rate', label: 'Interest rate (margin)', type: 'percent' },
      { key: 'leverage_covenant', label: 'Leverage covenant (max)', type: 'percent' },
      { key: 'security', label: 'Security / collateral', type: 'text' },
      { key: 'governing_law', label: 'Governing law', type: 'text' },
    ],
  },
  {
    name: 'Supplier scorecard KPIs',
    description: 'Operational KPIs from supplier scorecard spreadsheets.',
    fields: [
      { key: 'on_time_delivery', label: 'On-time delivery %', type: 'percent' },
      { key: 'defect_rate', label: 'Defect rate (ppm)', type: 'number' },
      { key: 'lead_time_days', label: 'Average lead time (days)', type: 'number' },
      { key: 'annual_spend', label: 'Annual spend', type: 'currency' },
      { key: 'capacity_utilization', label: 'Capacity utilization', type: 'percent' },
      { key: 'certifications', label: 'Certifications held', type: 'text' },
    ],
  },
  {
    name: 'Covenant tests',
    description: 'Quarterly covenant compliance figures.',
    fields: [
      { key: 'leverage_ratio', label: 'Total leverage ratio', type: 'number' },
      { key: 'interest_coverage', label: 'Interest coverage', type: 'number' },
      { key: 'min_liquidity', label: 'Minimum liquidity', type: 'currency' },
      { key: 'net_debt_ebitda', label: 'Net debt / EBITDA', type: 'number' },
      { key: 'compliance_status', label: 'Compliance status', type: 'text' },
    ],
  },
];

async function seedTemplates() {
  for (const t of BUILT_IN_TEMPLATES) {
    const exists = await prisma.extractionTemplate.findFirst({
      where: { workspaceId: null, name: t.name },
    });
    if (!exists) {
      await prisma.extractionTemplate.create({
        data: { workspaceId: null, name: t.name, description: t.description, fields: t.fields },
      });
      console.log(`template created: ${t.name}`);
    }
  }
}

// ── Demo dataset (SEED_DEMO=true) ───────────────────────────────────
async function seedDemo() {
  const email = (process.env.SEED_DEMO_EMAIL || 'demo@lumen.example').toLowerCase();
  const password = process.env.SEED_DEMO_PASSWORD || 'LumenDemo2026!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('demo user already exists — skipping demo seed');
    return;
  }

  const demoUser = await prisma.user.create({
    data: {
      email,
      firstName: 'Amara',
      lastName: 'Menon',
      passwordHash: await bcrypt.hash(password, 12),
      emailVerifiedAt: new Date(),
      onboardingStep: 4,
    },
  });
  console.log(`demo user: ${email} / ${password} (change SEED_DEMO_PASSWORD)`);

  const ws = await prisma.workspace.create({
    data: {
      name: 'Northwind Capital (Demo)',
      slug: 'northwind-capital-demo',
      industry: 'Finance',
      createdById: demoUser.id,
      memberships: { create: [{ userId: demoUser.id, role: 'OWNER' }] },
      settings: {
        create: {
          key: 'questionnaires.rules',
          value: { requireCitations: true, lowConfidenceThreshold: 0.85, autoApproveHighConfidence: false },
        },
      },
    },
  });

  const collections = Object.fromEntries(
    await Promise.all(
      ['Earnings 2026', 'Financing', 'Vendor contracts', 'Operations', 'Security', 'Research'].map(
        (name) =>
          prisma.collection
            .create({ data: { workspaceId: ws.id, name, createdById: demoUser.id } })
            .then((c) => [name, c.id]),
      ),
    ),
  );

  // ── Demo documents with extracted structure (no original files) ────
  const docs: { name: string; type: string; pages: number; collection: string; sizeKb: number; sections: [string, number, string][]; tableRows?: Record<string, string>[]; summary: string }[] = [
    {
      name: 'Halden Industrial Q3 2026 Earnings Release.pdf',
      type: 'pdf', pages: 24, collection: 'Earnings 2026', sizeKb: 1840,
      sections: [
        ['HIGHLIGHTS', 1, 'Third quarter revenue of $4.82 billion, up 8.3% year-over-year driven by Industrial Automation and Grid Components.'],
        ['HIGHLIGHTS', 1, 'Operating margin of 14.8%, up 40 basis points year-over-year.'],
        ['HIGHLIGHTS', 1, 'Free cash flow of $603 million, up 11% year-over-year.'],
        ['FINANCIAL REVIEW', 2, 'Consolidated revenue grew 8.3% to $4.82B. Segment growth: Industrial Automation +12.4%, Grid Components +9.1%, Fluid Systems +2.0%, Building Controls +5.6%.'],
        ['FINANCIAL REVIEW', 3, 'Net debt stood at $3.1 billion at quarter end, a reduction of $214 million from the prior quarter.'],
        ['OUTLOOK', 5, 'Management raised full-year 2026 revenue growth guidance to 7–8% from 6–7%.'],
      ],
      summary: 'Q3 2026 results: revenue $4.82B (+8.3% YoY), operating margin 14.8% (+40 bps), free cash flow $603M (+11%), net debt $3.1B. Guidance raised to 7–8% revenue growth for FY 2026.',
    },
    {
      name: 'Tessera Bank Credit Agreement.pdf',
      type: 'pdf', pages: 112, collection: 'Financing', sizeKb: 5210,
      sections: [
        ['1. DEFINITIONS', 2, '“Consolidated Total Leverage Ratio” means the ratio of Consolidated Total Debt to Consolidated EBITDA.'],
        ['6. FINANCIAL COVENANTS', 41, 'The Borrower shall not permit the Consolidated Total Leverage Ratio to exceed 3.50:1.00 at any time.'],
        ['6. FINANCIAL COVENANTS', 42, 'The Borrower shall maintain Consolidated Interest Coverage of not less than 3.00:1.00.'],
        ['9. EVENTS OF DEFAULT', 67, 'Failure to pay any principal within three business days of when due constitutes an Event of Default.'],
        ['11. GOVERNING LAW', 108, 'This Agreement shall be governed by the laws of the State of New York.'],
      ],
      summary: 'Facility agreement with Tessera Bank: maximum leverage 3.50x, minimum interest coverage 3.00x, maturity 2029, governing law New York.',
    },
    {
      name: 'Corvane Systems Master Services Agreement.docx',
      type: 'docx', pages: 18, collection: 'Vendor contracts', sizeKb: 320,
      sections: [
        ['2. SERVICES', null, 'Supplier shall provide managed detection and response services, 24×7 monitoring, and quarterly threat-landscape reviews.'],
        ['7. DATA PROTECTION', null, 'Supplier shall encrypt customer data at rest (AES-256) and in transit (TLS 1.2+), and notify Customer of any incident within 72 hours.'],
        ['12. TERM AND TERMINATION', null, 'Initial term of three years from the Effective Date, renewing annually unless terminated with 90 days notice.'],
      ],
      summary: 'MSA with Corvane Systems for managed security services: 3-year term, AES-256 at rest, 72-hour incident notification, SOC 2 Type II required annually.',
    },
    {
      name: 'Plant 4 Supplier Scorecard Q3 2026.xlsx',
      type: 'xlsx', pages: null, collection: 'Operations', sizeKb: 96,
      sections: [['Sheet: KPIs', null, 'Quarterly supplier KPI summary for Plant 4.']],
      tableRows: [
        { Supplier: 'Veymar Castings', 'On-time delivery %': '94.2', 'Defect rate (ppm)': '220', 'Spend (USD)': '2,140,000' },
        { Supplier: 'Ostfeld Precision', 'On-time delivery %': '98.7', 'Defect rate (ppm)': '85', 'Spend (USD)': '1,468,500' },
        { Supplier: 'Lindqvist Tooling', 'On-time delivery %': '91.3', 'Defect rate (ppm)': '410', 'Spend (USD)': '820,300' },
      ],
      summary: 'Plant 4 supplier scorecard: three suppliers tracked; Ostfeld Precision leads on-time delivery (98.7%) and defect rate (85 ppm).',
    },
  ];

  for (const d of docs) {
    const doc = await prisma.document.create({
      data: {
        workspaceId: ws.id,
        collectionId: collections[d.collection],
        name: d.name,
        fileType: d.type,
        mimeType: 'application/octet-stream',
        sizeBytes: d.sizeKb * 1024,
        pageCount: d.pages,
        status: 'COMPLETED',
        storageKey: 'demo/placeholder',
        ownerId: demoUser.id,
        isDemo: true,
        processedAt: new Date(),
      },
    });

    let order = 0;
    for (const [heading, page, text] of d.sections) {
      const headingExists = await prisma.documentSection.findFirst({
        where: { documentId: doc.id, kind: 'HEADING', text: heading },
      });
      if (!headingExists) {
        await prisma.documentSection.create({
          data: { documentId: doc.id, kind: 'HEADING', headingPath: [heading], page, order: order++, text: heading },
        });
      }
      await prisma.documentSection.create({
        data: { documentId: doc.id, kind: 'PARAGRAPH', headingPath: [heading], page, order: order++, text },
      });
      await prisma.documentChunk.create({
        data: { documentId: doc.id, page, headingPath: [heading], kind: 'PARAGRAPH', text: `${heading}\n${text}`, tokenEstimate: Math.ceil((heading.length + text.length) / 4) },
      });
    }

    if (d.tableRows?.length) {
      const header = Object.keys(d.tableRows[0]);
      const table = await prisma.documentTable.create({
        data: { documentId: doc.id, sheet: 'KPIs', title: `${d.name.replace('.xlsx', '')} — KPIs`, order: 0, header },
      });
      let rowIndex = 0;
      for (const row of d.tableRows) {
        const cells = header.map((h) => row[h]);
        await prisma.documentTableRow.create({ data: { tableId: table.id, rowIndex: rowIndex++, cells } });
        await prisma.documentChunk.create({
          data: {
            documentId: doc.id, sheet: 'KPIs', headingPath: [table.title!], tableId: table.id,
            kind: 'TABLE_ROW', tokenEstimate: 60,
            text: `${table.title} (sheet “KPIs”)\nColumns: ${header.join(' | ')}\nRow ${rowIndex}:\n${header.map((h, i) => `${h}: ${cells[i]}`).join('\n')}`,
          },
        });
      }
    }

    await prisma.documentSummary.create({
      data: { documentId: doc.id, summary: d.summary, keyFacts: [], figures: [], model: 'demo' },
    });
  }

  // ── Demo entity + observations (Halden Industrial Group) ──────────
  const haldenDocs = await prisma.document.findMany({
    where: { workspaceId: ws.id, name: { contains: 'Halden' } },
    select: { id: true },
  });
  const earningsDoc = haldenDocs[0];

  const entity = await prisma.entity.create({
    data: { workspaceId: ws.id, name: 'Halden Industrial Group' },
  });
  const observations: { key: string; label: string; periods: [string, number][] }[] = [
    { key: 'revenue', label: 'Revenue', periods: [['Q4 2025', 4.45], ['Q1 2026', 4.52], ['Q2 2026', 4.61], ['Q3 2026', 4.82]] },
    { key: 'operating_margin', label: 'Operating margin', periods: [['Q4 2025', 13.9], ['Q1 2026', 14.2], ['Q2 2026', 14.5], ['Q3 2026', 14.8]] },
    { key: 'free_cash_flow', label: 'Free cash flow', periods: [['Q4 2025', 512], ['Q1 2026', 521], ['Q2 2026', 543], ['Q3 2026', 603]] },
    { key: 'net_debt', label: 'Net debt', periods: [['Q4 2025', 3.42], ['Q1 2026', 3.38], ['Q2 2026', 3.31], ['Q3 2026', 3.1]] },
    { key: 'segment:industrial_automation', label: 'Industrial Automation revenue', periods: [['Q3 2026', 1.94]] },
    { key: 'segment:grid_components', label: 'Grid Components revenue', periods: [['Q3 2026', 1.62]] },
    { key: 'segment:fluid_systems', label: 'Fluid Systems revenue', periods: [['Q3 2026', 0.71]] },
    { key: 'segment:building_controls', label: 'Building Controls revenue', periods: [['Q3 2026', 0.55]] },
  ];
  for (const o of observations) {
    for (const [period, value] of o.periods) {
      await prisma.metricObservation.create({
        data: {
          entityId: entity.id, metricKey: o.key, label: o.label, period, value,
          unit: o.key === 'operating_margin' ? '%' : o.key === 'free_cash_flow' ? 'USD millions' : o.key.startsWith('segment:') ? 'USD billions' : o.key === 'net_debt' ? 'USD billions' : 'USD billions',
          derivation: 'REPORTED',
          sourceDocumentId: earningsDoc?.id ?? null,
          sourceExcerpt: 'Demo observation seeded from the Lumen reference content — verify against the source document.',
        },
      });
    }
  }

  await prisma.report.create({
    data: {
      workspaceId: ws.id, entityId: entity.id, title: 'Halden Industrial — Quarterly review',
      type: 'quarterly', createdById: demoUser.id,
    },
  });

  // ── Demo questionnaire (Vendor security assessment) ─────────────
  const questionnaire = await prisma.questionnaire.create({
    data: {
      workspaceId: ws.id,
      title: 'Vendor security assessment 2026 (Demo)',
      description: 'SIG-Lite-style vendor security questionnaire, demo content.',
      source: 'imported',
      status: 'in_progress',
      createdById: demoUser.id,
    },
  });
  const qs: [string, string, string, string | null, number | null][] = [
    ['Network security', 'yes_no', 'Do you maintain network segmentation between production and corporate environments?', null, 0.97],
    ['Network security', 'yes_no', 'Are all external network connections encrypted with TLS 1.2 or higher?', null, 0.96],
    ['Data protection', 'yes_no', 'Is customer data encrypted at rest using AES-256 or stronger?', null, 0.95],
    ['Data protection', 'text', 'Describe your data retention and deletion policy for customer data.', null, 0.91],
    ['Incident response', 'yes_no', 'Do you notify customers of security incidents within 72 hours?', null, 0.94],
    ['Incident response', 'text', 'Describe your incident response process and escalation path.', null, 0.88],
    ['Access control', 'yes_no', 'Do you enforce multi-factor authentication for all administrative access?', null, 0.82],
    ['Access control', 'yes_no', 'Are access reviews performed at least quarterly?', null, 0.79],
    ['Business continuity', 'text', 'Describe your backup and disaster recovery strategy.', null, 0.86],
    ['Compliance', 'yes_no', 'Do you hold a current SOC 2 Type II attestation?', null, 0.93],
    ['Compliance', 'multiple_choice', 'Which compliance frameworks do you currently maintain?', JSON.stringify(['SOC 2', 'ISO 27001', 'HIPAA', 'FedRAMP']), 0.9],
    ['Subprocessors', 'text', 'List all subprocessors with access to customer data.', null, null],
  ];
  for (let i = 0; i < qs.length; i++) {
    const [section, type, prompt, options, conf] = qs[i];
    const question = await prisma.question.create({
      data: {
        questionnaireId: questionnaire.id, section, type, prompt, order: i,
        options: options ? (JSON.parse(options) as string[]) : null,
        required: true,
      },
    });
    const hasAnswer = conf != null;
    const needsReview = hasAnswer && conf! < 0.85;
    if (hasAnswer) {
      const answer = await prisma.questionAnswer.create({
        data: {
          questionId: question.id,
          draftAnswer: type === 'yes_no' ? 'Yes' : 'Draft answer based on the Master Services Agreement (demo).',
          confidence: conf,
          status: needsReview ? 'NEEDS_REVIEW' : 'AI_DRAFTED',
        },
      });
      await prisma.answerEvidence.create({
        data: {
          answerId: answer.id,
          kind: 'PARAGRAPH',
          excerpt: 'Demo evidence excerpt referencing the Corvane Systems MSA.',
        },
      });
    } else {
      await prisma.questionAnswer.create({ data: { questionId: question.id, status: 'MISSING' } });
    }
  }

  // ── Demo conversation ─────────────────────────────────────────────
  const conversation = await prisma.conversation.create({
    data: {
      workspaceId: ws.id, userId: demoUser.id,
      title: 'Halden Q3 — leverage and liquidity',
    },
  });
  const um = await prisma.message.create({
    data: { conversationId: conversation.id, role: 'USER', content: "What is Halden's leverage position and how did net debt move this quarter?" },
  });
  void um;
  const am = await prisma.message.create({
    data: {
      conversationId: conversation.id, role: 'ASSISTANT',
      content: "Halden's net debt stood at $3.1B at Q3 2026 quarter end, down $214M from the prior quarter [1]. This is the value highlighted in the earnings release financial review. I don't have the leverage ratio itself in the retrieved passages — the credit agreement's covenant threshold (3.50x) is separate context, not a reported Halden ratio.",
      model: 'demo',
    },
  });
  await prisma.citation.create({
    data: {
      messageId: am.id, documentId: earningsDoc?.id ?? '', ref: 1, kind: 'PAGE', page: 3,
      tableRef: 'Page 3',
      excerpt: 'Net debt stood at $3.1 billion at quarter end, a reduction of $214 million from the prior quarter.',
    },
  });

  console.log('demo workspace seeded');
}

async function main() {
  await seedTemplates();
  if (process.env.SEED_DEMO === 'true') await seedDemo();
  else console.log('SEED_DEMO not set — templates only');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
