# GAPS.md — Original System Gaps & Rebuild Improvements

## 1. Verified Gaps in the Original Codebase

Below are the 10 verified gaps identified in the original `flexprice/flexprice` engine:

1. **Security — Missing RBAC on Read Endpoints**: Read routes across major entities (`GET /v1/events`, `GET /v1/meters`, `GET /v1/customers`, `GET /v1/wallets`, `GET /v1/invoices`, `POST /v1/customers/search`) omit `read(types.Entity*, types.ActionRead)`. An API key holding only the `event_ingestor` role can query all sensitive customer records, invoices, and balances.
   - *Evidence*: [internal/api/router.go:211](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/api/router.go#L211), [internal/config/rbac/roles.json:30](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/config/rbac/roles.json#L30) [Confirmed]

2. **Data Integrity — Silent Event Ingestion Loss**: In `CreateEvent` and `bulkCreateEventsBatched`, message publisher failures (e.g. Kafka disconnects) are logged but explicitly swallowed. The method returns `nil`, and Gin responds with `202 Accepted`. Clients assume events were stored, leading to permanent unbilled usage and revenue loss.
   - *Evidence*: [internal/ee/service/event.go:75](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/ee/service/event.go#L75), [internal/ee/service/event.go:122](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/ee/service/event.go#L122) [Confirmed]

3. **Correctness — Customer Portal Self-Update Blocked by RBAC**: `PUT /v1/customer/portal/info` attaches `write(types.EntityCustomer, types.ActionWrite)`. Portal sessions authenticate via tokens naming a customer ID without staff roles. Consequently, legitimate portal users are rejected with `403 Forbidden` (`"access denied: caller has no roles assigned"`), directly violating the router's own architectural comments.
   - *Evidence*: [internal/api/router.go:697–706](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/api/router.go#L697-L706) [Confirmed]

4. **Correctness & Concurrency — Missing Idempotency in Subscription Creation**: `CreateSubscription` does not accept or validate an idempotency key, does not check if an active subscription already exists for the customer and plan, and has no database uniqueness constraint. Concurrent requests create duplicate active subscriptions, duplicate billing, and competing Temporal renewal workflows.
   - *Evidence*: [internal/ee/service/subscription.go:77](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/ee/service/subscription.go#L77), [ent/schema/subscription.go:249](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/ent/schema/subscription.go#L249) [Confirmed]

5. **Security & Configuration — RBAC Identifier Mismatch on Checkout**: Route `DELETE /v1/checkout/sessions/:id` passes raw string literal `"checkout_session"` rather than `types.EntityCheckoutSession` (`"checkoutsession"`), breaking role permission checks.
   - *Evidence*: [internal/api/router.go:470](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/api/router.go#L470), [internal/types/rbac.go:100](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/types/rbac.go#L100) [Confirmed]

6. **Input Validation — `CreateOneOffInvoice` Bypasses Validation**: `InvoiceHandler.CreateOneOffInvoice` and `invoiceService.CreateOneOffInvoice` (when `Checkout == nil`) never call `req.Validate()`. Callers can submit invalid dates, negative amounts due on non-credit invoices, or missing required fields.
   - *Evidence*: [internal/ee/service/invoice.go:119](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/ee/service/invoice.go#L119), [internal/api/dto/invoice.go:471](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/api/dto/invoice.go#L471) [Confirmed]

7. **Data Integrity — Decoupled Negative Wallet State on Manual Debit**: `ManualBalanceDebit` ignores insufficient balance checks in `processDebitOperation`. `ConsumeCredits` only consumes available credits up to zero, driving `w.CreditBalance` negative without recording ledger transactions for the deficit.
   - *Evidence*: [internal/ee/service/wallet.go:2316](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/ee/service/wallet.go#L2316), [internal/repository/ent/wallet.go:326](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/repository/ent/wallet.go#L326) [Confirmed]

8. **Input Validation — `AuthHandler.SignUp` Omits DTO Validation**: `AuthHandler.Login` calls `req.Validate()`, but `AuthHandler.SignUp` passes raw bound JSON directly to the service layer without struct validation.
   - *Evidence*: [internal/api/v1/auth.go:30](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/api/v1/auth.go#L30), [internal/api/v1/auth.go:65](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/api/v1/auth.go#L65) [Confirmed]

9. **Documentation Drift — Misleading ClickHouse UI & Non-Executable Root `main.go`**: README claims ClickHouse Web UI runs at `http://localhost:8123` (which is only an HTTP API returning `Ok.`). Furthermore, root `main.go` is an empty 2-line stub without `func main()`, breaking `go run main.go`.
   - *Evidence*: [README.md:132](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/README.md#L132), [docker-compose.yml:49](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/docker-compose.yml#L49), [main.go:1](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/main.go#L1) [Confirmed]

10. **Configuration — Dead RBAC Fallback Path**: In `internal/rbac/rbac.go:36`, default fallback path is `./config/rbac/roles.json`, but the actual configuration file is stored in `internal/config/rbac/roles.json`.
    - *Evidence*: [internal/rbac/rbac.go:36](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/rbac/rbac.go#L36), [internal/config/config.yaml:554](file:///c:/Users/nares/OneDrive/Desktop/flexprice-main/flexprice-main/internal/config/config.yaml#L554) [Confirmed]

---

## 2. The Two Core Improvements We Will Build

### Improvement 1: Guaranteed Event Delivery with Synchronous Ingestion Error Surfacing & Backpressure
- **What We Will Build**:
  We will re-architect `POST /v1/events` and `POST /v1/events/bulk` to provide true durable delivery guarantees. The API will await broker partition receipt confirmation before returning HTTP 202. If the message broker is degraded, overloaded, or unreachable, the endpoint will immediately surface an explicit error (`503 Service Unavailable` with retry-after headers) rather than swallowing the failure.
- **Why It Matters to the User**:
  In a usage-based billing platform, unrecorded telemetry events mean lost money that can never be recovered from the customer. For SaaS and AI developers streaming millions of events, a billing system that falsely reports success while dropping data destroys customer trust and causes irrecoverable revenue leakage. Synchronous broker acknowledgment guarantees that client SDKs know when to buffer and retry.

### Improvement 2: Complete Default-Deny RBAC & Idempotent Subscription Lifecycle
- **What We Will Build**:
  1. We will enforce strict `read(types.Entity, types.ActionRead)` gates across every entity query route in `router.go`, while isolating customer portal session tokens from internal staff permissions.
  2. We will implement mandatory idempotency keys and PostgreSQL row-level advisory locks on `(tenant_id, customer_id)` during subscription creation, supported by partial database unique indexes on active non-metered subscriptions.
- **Why It Matters to the User**:
  1. Security: Scoped ingestion tokens (e.g. embedded in high-frequency logging agents or distributed microservices) cannot be abused by bad actors or misconfigured services to siphon customer databases, invoices, or financial ledgers.
  2. Billing Correctness: Network retries or rapid double-clicks on checkout screens will never spawn duplicate subscriptions or run colliding Temporal cron renewal workflows. The customer is charged once, and invoice calculations remain strictly deterministic.
