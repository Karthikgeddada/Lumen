// ChartSpec — the ONLY way to ask for chart data, from any caller (frontend
// Explore, presets, saved views, the Assistant). Pure Zod: strict objects,
// whitelisted dataset ids, whitelisted filter ids per dataset, whitelisted
// chart ids, no arbitrary fields, no raw SQL, no free-form anything. An
// unknown anything is a 400 with the reason — never a silent ignore.

import { z } from 'zod';
import { CHART_CATALOG, DATASETS, INTENTS, chartEntry } from './catalog';

// Filter values are bounded ids/keys, not free text: entity ids and metric
// keys are cuids/snake_case strings. Everything has a cap.
const idList = z.array(z.string().trim().min(1).max(64)).max(50);

// Factory: the T3 rejection is gated by the CHARTS_EXPERIMENTAL flag, which
// lives in the service layer (core stays pure — no env reads).
export function makeChartSpecSchema(chartsExperimental: boolean) {
  return z
  .object({
    dataset: z.string().refine((id) => DATASETS.some((d) => d.id === id), {
      message: 'Unknown dataset. See GET /charts/catalog for the whitelist.',
    }),
    filters: z
      .object({
        entities: idList.optional(), // entity ids
        metrics: idList.optional(), // metric keys
        derivations: idList.optional(), // REPORTED | CALCULATED | AI_INFERRED
        covenants: idList.optional(), // covenant keys
        statuses: idList.optional(), // PASS | FAIL | NOT_TESTED | WAIVED
        periodFrom: z.string().trim().max(12).optional(), // 'Q1 2025' | '2025'
        periodTo: z.string().trim().max(12).optional(),
      })
      .strict()
      .optional(),
    intent: z
      .string()
      .refine((id) => id === 'auto' || INTENTS.some((i) => i.id === id), {
        message: 'Unknown intent. See GET /charts/catalog.',
      })
      .default('auto'),
    // Optional explicit chart choice (Explore switcher / saved views).
    // Tier T2 entries carry a caution in the response; T3 requires the
    // CHARTS_EXPERIMENTAL flag and is rejected here otherwise.
    chart: z
      .string()
      .refine((id) => CHART_CATALOG.some((c) => c.id === id), {
        message: 'Unknown chart. See GET /charts/catalog.',
      })
      .optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.chart) {
      const entry = chartEntry(spec.chart);
      if (!entry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chart'],
          message: 'Unknown chart. See GET /charts/catalog.',
        });
      } else {
        if (entry.tier === 'T3' && !chartsExperimental) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['chart'],
            message: `Chart '${entry.id}' is experimental (CHARTS_EXPERIMENTAL off).`,
          });
        }
        if (spec.intent !== 'auto' && !entry.intents.includes(spec.intent as never)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['chart'],
            message: `Chart '${entry.id}' does not serve intent '${spec.intent}'.`,
          });
        }
      }
    }
    const ds = DATASETS.find((d) => d.id === spec.dataset);
    if (spec.filters && ds) {
      for (const key of Object.keys(spec.filters)) {
        if (!ds.filters.includes(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['filters', key],
            message: `Dataset '${ds.id}' does not support filter '${key}'. Whitelisted: ${ds.filters.join(', ') || 'none'}.`,
          });
        }
      }
    }
  });

}

// Default (T3 off) — for pure unit tests. Routes/services use the factory
// with the real flag.
export const ChartSpecSchema = makeChartSpecSchema(false);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

/** Validate a raw spec (saved view JSON, Assistant emission, request body). */
export function validateChartSpec(
  raw: unknown,
  chartsExperimental = false,
): { ok: true; spec: ChartSpec } | { ok: false; errors: string[] } {
  const parsed = makeChartSpecSchema(chartsExperimental).safeParse(raw);
  if (parsed.success) return { ok: true, spec: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`),
  };
}
