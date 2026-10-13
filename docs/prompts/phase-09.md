# Phase 09 — Management dashboard

Implement Phase 9: management dashboard for SUPERVISOR (own department only) and ADMIN (all departments) roles. Plan first.

Metrics (filter by date range, department, service, channel):
- Collections: confirmed minus completed refunds minus reversals, by service/channel/day; outstanding (assessed but unpaid); refunds and reversals
- Volumes: applications by status; submitted vs completed per week
- Processing time: median and p90 submit → decision; SLA compliance %; overdue count
- Pending work: queue sizes and oldest item per officer/department

Implementation:
- Aggregations via SQL views or a nightly + on-demand materialized view refresh job; never compute in the browser
- /api/v1/reports/* endpoints with role scoping; every number must reconcile with the transaction tables
- Web: KPI cards, line/bar charts (Recharts), sortable tables, drill-down from a KPI to the underlying filtered list, CSV export

Acceptance: a reconciliation test seeds known payments and asserts dashboard totals equal the sum of CONFIRMED payments minus completed refunds minus reversals, to the cent; a supervisor sees only their department's totals.
