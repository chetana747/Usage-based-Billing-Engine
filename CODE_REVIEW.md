# HACKBACK code review · DBG-249 · Usage-based Billing Engine
- Reviewed at: 2026-10-06T08:49:12Z (2026-10-06T14:19:12 IST)
- Judged commit: 2ae822b39c8c10e777f92acd006630c18728f5ce (2026-10-06T13:19:06+05:30) · the last commit before the code freeze
- Reviewer: AI agent run by a HACKBACK judge

### DBG-249 · Usage-based Billing Engine
Commit: 2ae822b39c8c10e777f92acd006630c18728f5ce · 2026-10-06T13:19:06+05:30 · Clean-room: see flags

| Section | Score | Why (path:line) |
|---|---|---|
| A. Core flow | 20/30 | Main business flow executes end-to-end client-side in browser JS (`app.js:69-155`), but the promised Go/HTTP backend API is missing (`README.md:20-30` not found in repo), batch ingestion is missing (`app.js:125`), and meters are not distinct configurable entities (`app.js:142`). |
| B. Killer Tests | 15/30 | KT1 deduplication attempted via in-memory dictionary with no database unique constraint (3/10, `app.js:131`); KT2 mid-month upgrade proration and date interval splitting logic is correct (6/10, `app.js:113-124`, `app.js:142`); KT3 tiered pricing matches hand calculation for graduated & volume but uses floating-point arithmetic rather than integer paise (6/10, `app.js:21`, `app.js:38-50`). |
| C. Two improvements | 10/20 | Improvement 1 (Broker backpressure 503) is partially simulated via UI checkbox/throw in JS (5/10, `app.js:53`, `app.js:127`); Improvement 2 (RBAC read gating & subscription idempotency) is partially built in-memory but lacks promised PostgreSQL locks and DB constraints (5/10, `app.js:10-18`, `app.js:55-60`, `app.js:96-103`). |
| D. Built from their docs | 2/10 | Severe drift: docs describe a Go/Gin/ClickHouse/PostgreSQL/Kafka headless engine (`docs/ARCHITECTURE.md:10-45`, `docs/DATA_MODEL.md:39-206`, `docs/API.md:9-147`) and explicitly specify "Won't Have: Interactive web frontend" (`docs/PRD.md:47`). Code is a client-side vanilla JS prototype with 0 Go/backend code. |
| E. Engineering | 4/10 | Basic input validation and role checks present in JS (`app.js:55-60`, `app.js:128-130`), no committed secrets (`.env.example`), and rich frontend UI. However, README commands fail/reference non-existent Go server (`README.md:20-30`), no HTTP endpoints or storage persistence, and late events/closed periods are not handled deliberately (`app.js:142`). |
| Total | 51/100 | |

Killer Tests:
1. PARTIAL · 3/10 · Deduplication attempted at `app.js:131` and tested in browser test suite at `app.js:498-505`, but implemented via an in-memory dictionary lookup (`if (S.e[id]) return "duplicate"; S.e[id] = ...`) with no database unique constraint, no persistence, and no backend server (hits explicit red flag).
2. PARTIAL · 6/10 · Correct proration logic in code (`app.js:113-124` calculating `rem = (o.pe - at) / (o.pe - o.ps)` and itemized credit/charge) with usage partitioned across subscription dates (`app.js:142` checking `e.ts >= s.ss && e.ts < s.se`). Tested with fixed dates at `app.js:507-512`, but tested solely in browser JS rather than on a server, and the automated test does not assert usage event split across the upgrade date.
3. PARTIAL · 6/10 · Tiered pricing correctly computes graduated and volume models matching hand calculation (`app.js:38-50`), verified in test suite at `app.js:514-520` (250k tokens yields ₹2,200 graduated, ₹2,000 volume, ₹2,250 with flat fee). However, money calculations use floating-point arithmetic (`Math.round(x * 100) / 100` at `app.js:21`) rather than integer paise, partial thousands lack an explicit stated rounding rule, and logic runs client-side only.

Improvements:
1. Guaranteed Event Delivery with Synchronous Ingestion Error Surfacing & Backpressure · 5/10 · Promised synchronous Kafka broker partition ACKs returning HTTP 503 (`docs/GAPS.md:41-46`, `SUBMISSION.md:8`). In code, this is simulated client-side via a toggle switch `let broker = true` (`app.js:53`, `app.js:358-370`) that throws an error in `ingest` when disabled (`app.js:127`) and tested at `app.js:522-527`. No real message broker or server backpressure exists.
2. Complete Default-Deny RBAC & Idempotent Subscription Lifecycle · 5/10 · Promised default-deny `read(...)` gating across all routes, customer portal token isolation, PostgreSQL advisory locks, and partial unique indexes (`docs/GAPS.md:47-54`, `SUBMISSION.md:9`). In code, in-memory RBAC roles (`app.js:10-18`) and `need(...)` permission checks (`app.js:55-60`) are enforced across engine methods, and subscription idempotency key replay is handled at `app.js:96-103` (tested at `app.js:529-544`). However, PostgreSQL locks, DB constraints, and portal isolation are absent.

Flags:
- Clean-room: In commit `9ee7e32` (2026-10-05T20:50:50+05:30), the entire original Flexprice repository (2,542 files, 1,077,919 lines) was committed into `flexprice/` prior to the documentation commit `304fc35` (2026-10-05T22:50:18+05:30), and subsequently removed in commit `bc29fc2` (2026-10-05T23:20:48+05:30).
- Fake: `README.md:16-30` and `SUBMISSION.md:6-14` claim a production Go backend with Gin, PostgreSQL 17, ClickHouse 24.9, Kafka, Temporal, and `go test -v -race ./...`. No Go backend or test files exist in the repository; the engine runs entirely as client-side JavaScript in `app.js`. Additionally, dashboard token volume charts and transaction stacks in `index.html:226-310,346-394` display static, hard-coded numbers not connected to ingested events.

3 questions for the judges to ask this team in their Defence, aimed at the weakest spots you found:
1. Your README and SUBMISSION.md specify a Go backend with PostgreSQL, ClickHouse, Kafka, and Temporal, providing `go run` and `go test` commands. Why is there no Go code or backing infrastructure in the repository, and why is the billing engine implemented entirely in client-side JavaScript?
2. In `app.js:131`, usage event deduplication is handled via an in-memory dictionary `S.e[id]`. How does this architecture handle server restarts, distributed workers, or concurrent event ingestion across multiple nodes without a database unique constraint?
3. Commit `9ee7e32` in your repository history inserted the complete 2,542-file Flexprice codebase before the `docs/` directory was created, and was later deleted in `bc29fc2`. What was the purpose of committing the original codebase directly into your rebuild repository?

SCORE core=20 kt=15 imp=10 docs=2 eng=4 total=51
