# ADR 0009: Dashboard figures from live SQL views

- Status: accepted
- Date: 2026-10-14

## Context
FR-120/FR-121 require collections, outstanding balances, volumes, processing times, SLA compliance and pending work for
supervisors (own department) and admins (all), filtered by dates, department, service and channel. Every figure must
reconcile with the transaction tables to the cent and drill down to the rows behind it. Pilot volumes are small
(thousands of applications per month).

## Options considered
1. Compute in the browser from raw lists: forbidden by the spec, and it leaks rows the user does not need.
2. Materialized views refreshed nightly and on demand: fast at large volume, but figures lag behind the ledger,
   and reconciliation depends on refresh timing.
3. Plain SQL views over indexed tables, aggregated per request: always exact, with no refresh job. It costs more per
   request at large volume.

## Decision
Option 3. `report_money_movement` turns the payment ledger into signed movements: CONFIRMED +, REFUNDED −, REVERSED −,
each dated when it happened. `report_application` gives one row per submitted application, with its outstanding
balance. `ReportsService` aggregates them with parameterised SQL. Money stays bigint cents (`sum(...)::text`) all the
way to the browser, which only formats. Supervisors are always forced to their own department.

## Consequences
- Reconciliation is structural: the integration test compares the dashboard with direct sums over `payment` and `refund`.
- If volumes grow, the same endpoints can read from materialized versions of these views, refreshed by a BullMQ job,
  with no API change.
- The views are hand-written SQL in a migration. Any change to payment or refund semantics must update them.
