# OBSERVATIONS.md

This document catalogs every verified architectural, functional, and implementation claim about the original `flexprice/flexprice` core API engine. Every claim is substantiated by exact file and line references from the codebase.

---

## 1. System Architecture & Routing Reality

- The repository is a 100% headless backend API engine implemented in Go (using the Gin web framework), containing 0 frontend screens, 0 SPA bundles, and 0 HTML view routes.
  Evidence: internal/api/router.go:140 [Confirmed]
- The official frontend dashboard is maintained in a completely separate repository (`flexprice-front`).
  Evidence: internal/ee/infrastructure/helm/flexprice/values.yaml:609 [Confirmed]
- The router defines public authentication endpoints (`/v1/auth/signup`, `/v1/auth/login`) under a guest authentication group.
  Evidence: internal/api/router.go:151 [Confirmed]
- Authenticated private routes are gated by tenant status, environment resolution, and tenant context middlewares.
  Evidence: internal/api/router.go:170 [Confirmed]
- Root `main.go` at the repository root contains only 2 lines (`package main`) with no `func main()`, requiring execution from `cmd/server/main.go`.
  Evidence: main.go:1 [Confirmed]
- The documentation directs developers to a non-existent ClickHouse Web UI on port 8123, which is actually ClickHouse's native HTTP REST API port (returning plain text `Ok.`).
  Evidence: README.md:132 [Confirmed]
- Docker Compose defines PostgreSQL 17 on 5432, Kafka 7.7.1 on 29092, ClickHouse 24.9 on 8123/9000, Redis 7 on 6379, and Temporal on 7233.
  Evidence: docker-compose.yml:1 [Confirmed]

---

## 2. Authentication, RBAC & Permission Enforcement

- Role definitions and permissions are stored in a static JSON configuration file.
  Evidence: internal/config/rbac/roles.json:1 [Confirmed]
- Five standard roles are defined: `super_admin` (`*.*`), `all_reader` (`*.read`), `all_writer` (`*.read,write`), `event_ingestor` (`event.write`), and `event_reader` (`event.read`).
  Evidence: internal/config/rbac/roles.json:2 [Confirmed]
- `NewRBACService` default fallback path points to `./config/rbac/roles.json`, which does not exist on disk unless explicitly configured to `internal/config/rbac/roles.json`.
  Evidence: internal/rbac/rbac.go:36 [Confirmed]
- The RBAC entity constant for checkout sessions is defined as `"checkoutsession"` (without an underscore).
  Evidence: internal/types/rbac.go:100 [Confirmed]
- In `router.go`, checkout session deletion invokes `write("checkout_session", ...)` using a raw string literal with an underscore, causing a mismatch with the role definition.
  Evidence: internal/api/router.go:470 [Confirmed]
- Read endpoints across multiple core resources (`GET /v1/events`, `GET /v1/meters`, `GET /v1/customers`, `GET /v1/wallets`, `GET /v1/invoices`) omit RBAC read permission middleware.
  Evidence: internal/api/router.go:211 [Confirmed]
- The customer portal API uses session token authentication, which sets `customer_id` and `tenant_id` in the context but leaves `roles` empty.
  Evidence: internal/api/router.go:692 [Confirmed]
- `PUT /v1/customer/portal/info` mistakenly attaches `write(types.EntityCustomer, types.ActionWrite)`, causing customer portal updates to always fail with 403 Forbidden.
  Evidence: internal/api/router.go:706 [Confirmed]
- The router documentation explicitly acknowledges that portal routes should not have RBAC middleware because session tokens carry no API-key roles.
  Evidence: internal/api/router.go:697 [Confirmed]

---

## 3. Event Ingestion & Telemetry Pipeline

- Event ingestion accepts single events via `POST /v1/events` and batches via `POST /v1/events/bulk` with strict request body size limits.
  Evidence: internal/api/router.go:207 [Confirmed]
- `IngestEvent` parses JSON, validates event properties, and invokes `eventService.CreateEvent`.
  Evidence: internal/api/v1/events.go:54 [Confirmed]
- In `CreateEvent`, when `publisher.Publish` fails (e.g. Kafka downtime), the error is logged but swallowed, returning `nil` and responding with HTTP 202 Accepted.
  Evidence: internal/ee/service/event.go:75 [Confirmed]
- In `bulkCreateEventsBatched`, publisher batch failures are also explicitly logged and swallowed without failing the request.
  Evidence: internal/ee/service/event.go:122 [Confirmed]
- Usage events are stored in ClickHouse's `events` table for high-throughput append-only analytics.
  Evidence: internal/clickhouse/events.go:45 [Confirmed]

---

## 4. Subscriptions, Pricing & Lifecycle

- `CreateSubscription` validates active customer status, plan status, and currency, then builds initial subscription line items.
  Evidence: internal/ee/service/subscription.go:77 [Confirmed]
- `CreateSubscription` does not accept or validate an idempotency key and does not check for existing active subscriptions for the same customer and plan.
  Evidence: internal/ee/service/subscription.go:90 [Confirmed]
- The PostgreSQL Ent database schema for `subscriptions` defines index fields but lacks a unique constraint across `(tenant_id, environment_id, customer_id, plan_id)`.
  Evidence: ent/schema/subscription.go:249 [Confirmed]
- Subscription dates and billing anchor calculations support both anniversary and calendar-aligned cycles.
  Evidence: internal/ee/service/subscription.go:177 [Confirmed]
- Subscriptions schedule recurring billing cycles and renewal automation via Temporal workflows.
  Evidence: internal/temporal/workflow/subscription.go:30 [Confirmed]

---

## 5. Invoicing & Document Generation

- Invoices support statuses: `DRAFT`, `FINALIZED`, `VOIDED`, and payment statuses: `PENDING`, `PAID`, `FAILED`.
  Evidence: internal/domain/invoice/model.go:21 [Confirmed]
- `CreateOneOffInvoice` binds incoming requests but does not call `req.Validate()`.
  Evidence: internal/api/v1/invoice.go:49 [Confirmed]
- In `invoiceService.CreateOneOffInvoice`, general validation is skipped when `req.Checkout == nil`.
  Evidence: internal/ee/service/invoice.go:119 [Confirmed]
- The DTO comment on `CreateInvoiceRequest` explicitly states that `Validate()` is not wired into `CreateOneOffInvoice`.
  Evidence: internal/api/dto/invoice.go:471 [Confirmed]
- Vector PDF generation compiles structured JSON invoice payloads through Typst markup templates.
  Evidence: assets/typst-templates/invoice.typ:1 [Confirmed]
- PDF template compilation is handled by `internal/pdf/service.go` invoking the Typst CLI compiler.
  Evidence: internal/pdf/service.go:52 [Confirmed]
- Invoice PDFs are served dynamically via `GET /v1/invoices/:id/pdf`.
  Evidence: internal/api/router.go:447 [Confirmed]

---

## 6. Wallets, Credits & Ledgers

- Wallets support prepaid and postpaid models with a designated top-up conversion rate.
  Evidence: internal/domain/wallet/model.go:14 [Confirmed]
- `TopUpWallet` supports direct credits and invoiced credits, applying slab-based bonus credits if configured.
  Evidence: internal/ee/service/wallet.go:628 [Confirmed]
- In `processDebitOperation`, when total available credits are less than the debit amount and transaction reason is `MANUAL_BALANCE_DEBIT`, the insufficient balance error is skipped.
  Evidence: internal/ee/service/wallet.go:2316 [Confirmed]
- In `ConsumeCredits`, the repository only decrements existing credit transactions up to their available balance, leaving unbacked debit amounts unrecorded in transaction rows while decrementing the master wallet balance into negative values.
  Evidence: internal/repository/ent/wallet.go:326 [Confirmed]

