// Single source of truth for chart ids, tiers, intents, datasets and field
// whitelists: the PURE backend catalog (zero imports outside its own
// directory). The frontend re-exports it so chart ids and rules are never
// hard-coded twice — every change flows from
// backend/src/analytics/core/charts/catalog.ts.
export * from '../../../backend/src/analytics/core/charts/catalog';
