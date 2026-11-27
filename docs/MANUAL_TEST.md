## Chart engine demo data (item 5)

To load chart-engine demo data into a NON-PRODUCTION workspace (never the demo workspace):

```
cd backend
ALLOW_SEED_CHARTS=1 DATABASE_URL=<url> AUTH_SECRET=<any> npm run seed:charts-demo -- --workspace-slug <slug>
```

The script is idempotent (re-running replaces the seven demo entities with identical data), refuses without ALLOW_SEED_CHARTS=1, and prints a status-count summary. It creates 7 entities / 8 quarters / mixed units / a real gap (Bristol Q3 2026 revenue) / an annual period / an AI_INFERRED point / an unresolved-scale observation / formula covenants with a step-down schedule / every covenant status (PASS, near-breach, FAIL, NOT_TESTED, WAIVED) / two revisions. Explore (item 8) should then recommend: trend → line, status-matrix → heatmap, funnel → funnel, lineage → tree.

