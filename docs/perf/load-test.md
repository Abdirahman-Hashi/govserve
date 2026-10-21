# Load test (Phase 12, NFR-006)

**Result: NFR-006 is met with a wide margin on this machine.** Reads p95 8 ms (target ≤ 500 ms), writes p95 39 ms
(target ≤ 1 s), 0 failed checks out of 38,480, with 200 users browsing, 50 submitting and 20 paying at the same time
for 5 minutes. These numbers come from one laptop (Docker Desktop, 4 vCPUs, 6 GB) running the production images, so they
are indicative only; the launch checklist requires a re-run on the staging VM.

## How it was run
- `perf/k6/run.sh` (k6 v1.8.1), mix in `perf/k6/govserve.js`:
  - **browsing (200 VUs):** web app shell, catalogue list, one service, and sometimes the verify keys and a certificate
    lookup, with 1–5 s think time;
  - **submitting (50 VUs):** sign in once, create a proof-of-address draft, two autosaves, two uploads (pre-signed PUT
    to the object store, then confirm), wait for the ClamAV scan, submit, view status and list, withdraw;
  - **paying (20 VUs):** the same application, then mobile-money evidence or a card payment through the mock gateway
    (signed webhook), wait for the payment to show, withdraw.
- Full stack from `make up`: Caddy → nginx → API (one container, workers in process), PostgreSQL 16, Redis, RustFS,
  ClamAV. Rate limiting off for the run only (all load from one IP). Query statistics from `pg_stat_statements`.
- Thresholds in the script: reads p95 < 500 ms, writes p95 < 1 s, checks ≥ 99% (browsing) and ≥ 95% (others).

## p95 per endpoint (final run, 2026-10-20)
| Endpoint | Kind | Requests | p50 ms | p95 ms | max ms | Non-2xx |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /auth/login` | write | 70 | 335.5 | 512.1 | 528.3 | 0 |
| `POST /applications` | write | 893 | 7.2 | 227.6 | 245.7 | 0 |
| `POST mock checkout pay` | gateway | 119 | 11.1 | 53.2 | 195.5 | 0 |
| `POST /applications/:id/withdraw` | write | 893 | 9.3 | 40.4 | 269.6 | 0 |
| `PATCH /applications/:id` | write | 1786 | 7.9 | 36.9 | 236.9 | 0 |
| `POST /applications/:id/submit` | write | 893 | 10.1 | 36.7 | 212.6 | 0 |
| `POST /documents/:id/complete` | write | 1786 | 7.8 | 32.7 | 186.0 | 0 |
| `GET /applications` | read | 1547 | 3.3 | 23.6 | 432.0 | 0 |
| `POST /applications/:id/documents` | write | 1786 | 5.2 | 23.4 | 185.7 | 0 |
| `POST /applications/:id/payments` | write | 120 | 6.1 | 23.1 | 59.7 | 0 |
| `POST /applications/:id/payments/card` | write | 119 | 5.6 | 21.0 | 89.0 | 0 |
| `GET /applications/:id` | read | 1786 | 4.0 | 14.6 | 140.2 | 0 |
| `PUT object store (pre-signed)` | storage | 1786 | 4.0 | 14.2 | 84.2 | 0 |
| `GET /payments` | read | 239 | 3.0 | 13.5 | 57.2 | 0 |
| `GET /notifications/unread-count` | read | 654 | 2.2 | 7.9 | 21.6 | 0 |
| `GET /catalogue/services` | read | 8076 | 1.4 | 7.8 | 466.7 | 0 |
| `GET /verify/keys` | read | 1614 | 1.9 | 7.3 | 100.7 | 0 |
| `GET /verify/c/:no` | read | 1614 | 1.7 | 6.9 | 108.8 | 1614 |
| `GET /catalogue/services/:code` | read | 8076 | 1.7 | 6.5 | 108.9 | 0 |
| `GET mock checkout page` | gateway | 119 | 1.3 | 5.4 | 67.0 | 0 |
| `GET / (web app)` | read | 8076 | 1.0 | 4.4 | 117.3 | 0 |

"Non-2xx" on `GET /verify/c/:no` are the expected 404s for random certificate numbers. Storage and gateway rows are
outside the API's targets. Of the 425 non-sign-in requests over 100 ms, 376 fell in the first 5 seconds, when every virtual user starts at
once; the other 49 came in short spikes at 10, 101–103 and 130–131 s, not a steady trend.

## Bottlenecks and what was done

Runs compared (same machine, same mix): **baseline** (Phase 11 images), **tuned** (catalogue cache, database pool 20,
`UV_THREADPOOL_SIZE=8`) and **final** (catalogue cache only, what ships). Run-to-run noise on the laptop is about ±2×
on small p95 values, so only large or structural differences count.

| # | Bottleneck (evidence) | Change | Outcome |
| --- | --- | --- | --- |
| 1 | **Public catalogue** was the most frequent work: about 28,700 `service_version` queries in 5 min, nearly two per browsing request, for data that changes only when an admin publishes | 30 s in-process cache of the public list and service detail, cleared at once by every admin change in this process (`CatalogueService`, tested both ways) | `service_version` queries down to 11,600 (59% fewer; the rest are form validation on autosave and submit). Catalogue p95 stayed at 3–8 ms. **Kept.** |
| 2 | **Write bursts:** when 70 users start at once, `POST /applications` p95 is 212–256 ms (p50 7 ms). Every audited write takes the audit-chain advisory lock (ADR-0010), held until commit | Tried a larger database pool (20 instead of 10) | No gain: more concurrent transactions only queued on the chain lock (audit insert max 18 → 85 ms). **Reverted** to 10, kept configurable as `DATABASE_POOL_MAX`. Still far under the 1 s target. The structural fix, if write volume ever needs it, is to write the audit row last in each transaction (shorter lock hold) or per-day chains (ADR-0010 follow-up). |
| 3 | **Sign-in** p95 460–510 ms when 70 sign in at once: argon2id (19 MiB, 2 passes, by OWASP guidance) is CPU-bound and runs on libuv's 4-thread pool | Tried `UV_THREADPOOL_SIZE=8` | No measurable gain with 4 vCPUs (the work is CPU-bound). **Reverted**; the setting is a sizing lever for a VM with more than 4 vCPUs, to be checked on staging. The hash cost is a deliberate security control and stays. |

Not bottlenecks at this load: application detail and lists (p95 ≤ 24 ms), uploads, the virus-scan queue (every
document was clean within the 30 s the wizard waits), payments and the card webhook.

## Slowest queries (final run, by total time)
The audit-log insert (the chain trigger computes SHA-256 under the lock) is the largest total, mean 0.3–0.9 ms; no
query averages above 1 ms and no sequential scans appeared in Phase 08's plans (`docs/perf/search-plans.md`). Raw
k6 output and the query table for each run are under `perf/k6/results/` (not committed).

## Before launch
Re-run on the staging VM with the production VM size (RUNBOOK §Load test), and if sign-in p95 approaches 1 s with
more than 4 vCPUs, set `UV_THREADPOOL_SIZE` to the vCPU count and measure again.
