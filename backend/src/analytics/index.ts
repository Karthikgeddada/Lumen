// Public surface of the analytics module. Everything here was moved out of
// src/services (see docs/DECISIONS.md — move-only restructure, no behavior
// change; the route-table snapshot test guards the API surface).
export * from './overview';
export * from './periods';
export * from './ttm';
export * from './formula';
