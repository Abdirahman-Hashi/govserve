# Phase 09 — Management dashboard

Implement Phase 9: management dashboard for SUPERVISOR and ADMIN roles. Plan first.

Metrics (filter by date range, department, service, channel):
- Collections: total and by service/channel/day; outstanding assessments; reversals
- Volumes: applications by status; submitted vs completed per week
- Processing time: median and p90 submit → decision; SLA compliance %; overdue count
- Pending work: queue sizes and oldest item per officer/department

Implementation:
- Aggregations via SQL views or a nightly + on-demand materialized view refresh job; never compute in the browser
- /api/v1/reports/* endpoints with role scoping; every number must reconcile with the transaction tables
- Web: KPI cards, line/bar charts (Recharts), sortable tables, drill-down from a KPI to the underlying filtered list, CSV export

Acceptance: a reconciliation test seeds known payments and asserts dashboard totals equal the sum of CONFIRMED payments minus reversals, to the minor unit.
