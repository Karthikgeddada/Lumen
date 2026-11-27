// Public surface of the chart brain (pure). Consumers:
//   analytics/services/charts.ts — dataset loaders + the /charts endpoints
//   prisma seed scripts (demo data, via the service layer)
//   vitest — selector/guardrail/spec/profiler tests

export * from './catalog';
export * from './spec';
export * from './profiler';
export * from './guardrails';
export * from './selector';
