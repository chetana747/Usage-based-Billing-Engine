# PRD.md — Product Requirements Document

## 1. Problem
Modern SaaS and AI-native products rely on complex, dynamic pricing: hybrid subscriptions combining fixed recurring fees, metered compute units (e.g. tokens, API queries), overage thresholds, prepaid credit wallets, and promotional coupons. Traditional billing engines and payment gateways assume rigid, static monthly subscriptions, forcing developers to build fragile custom metering and rating logic in-house. Furthermore, existing open-source solutions often suffer from silent event ingestion data loss, incomplete role-based access control (RBAC), and duplicate subscription races under concurrent traffic.

## 2. Target User
- **Primary Persona**: Developer / SaaS Billing Engineer building usage-based and hybrid billing models for cloud and AI products.
- **Secondary Persona**: B2B End Customer reviewing itemized usage, topping up prepaid credit wallets, and downloading official tax invoices.
- *Card Brief & Killer Tests Persona*: Unknown (placeholder `[paste the Brief and the Killer Tests from the card]` was not expanded in prompt).

## 3. One-Line Problem Statement
> **"For SaaS and AI-native application developers who struggle with rigid billing models, complex high-throughput usage metering at scale, and silent event ingestion loss, our rebuild provides a deterministic, auditable, and idempotent metering and subscription billing engine, unlike custom home-grown billing scripts or rigid traditional subscription gateways."**

---

## 4. Core Flow (Numbered Steps)

1. **Tenant Onboarding & Key Provisioning**: The SaaS engineering team creates a tenant account (`POST /v1/auth/signup`) and generates scoped service API keys (`POST /v1/secrets/api/keys`).
2. **Catalog Definition**: The developer defines measurable usage meters (`POST /v1/meters`), tier-graduated rate cards (`POST /v1/prices`), and subscription packages (`POST /v1/plans`).
3. **Customer Provisioning**: The application syncs customer accounts to the billing system (`POST /v1/customers`).
4. **Subscription Activation**: The customer is subscribed to a plan (`POST /v1/subscriptions`), initiating recurring billing schedules.
5. **Usage Telemetry Ingestion**: The application streams high-frequency usage telemetry (`POST /v1/events` or `/bulk`) with immediate synchronous acknowledgment and delivery guarantees.
6. **Billing Period Rating & Invoicing**: At cycle close, the system rates aggregated usage against price tiers and produces an itemized draft invoice (`POST /v1/invoices/:id/compute`).
7. **Finalization & Payment Collection**: The invoice is locked (`POST /v1/invoices/:id/finalize`), compiled into a vector PDF (`GET /v1/invoices/:id/pdf`), and charged via the integrated payment gateway (`POST /v1/invoices/:id/payment/attempt`).

---

## 5. MoSCoW Feature Prioritization

### Must Have (P0)
- **Deterministic Usage Event Ingestion**: High-throughput single and bulk ingestion API with synchronous broker-backed durability guarantees and explicit error reporting (no silent swallows).
- **Idempotent Subscription Management**: Unique customer/plan constraints, idempotency key support, and concurrency locking to eliminate double-billing races.
- **Tiered & Metered Rating Engine**: Aggregation of usage events (SUM, COUNT, MAX, LATEST) across billing periods with graduated tiered pricing computation.
- **Comprehensive RBAC**: Unified default-deny permission enforcement across both read and write routes for all entities.
- **Itemized Invoice & Typst Vector PDF Generation**: Invoice lifecycle state machine (`DRAFT` → `FINALIZED` → `PAID` / `VOIDED`) with vector PDF compilation.

### Should Have (P1)
- **Prepaid & Postpaid Wallets**: Credit balance tracking with atomic transaction debit/credit ledgers and auto-topup threshold triggers.
- **Customer Self-Service Portal API**: Session-token authenticated endpoints enabling end customers to view subscriptions, inspect invoices, and manage payment methods without RBAC role conflicts.
- **Outbound Webhook Dispatch**: Signed webhook notifications for invoice finalization, payment failures, and credit depletion.

### Could Have (P2)
- **Promotional Coupons & Entitlement Grants**: Automated coupon application, duration bounds, and feature limit gating per plan.
- **Multi-Currency & FX Rate Conversions**: Custom currency configuration and automated foreign exchange rate adjustments.

### Won't Have (P3 - Out of Scope)
- Interactive web frontend / dashboard UI (managed in a decoupled frontend repository).
- Direct credit card processing without third-party gateways (Stripe/Razorpay handle raw PCI cardholder data).
- Integrated CRM / CPQ synchronization (external integration hooks only).

---

## 6. Acceptance Criteria (Given / When / Then)

### Scenario 1: Reliable Event Ingestion Durability
- **Given** an authenticated service client with role `event_ingestor`,
- **When** the client posts a valid usage event to `POST /v1/events` and the underlying message broker is unavailable,
- **Then** the server must NOT return `202 Accepted`; it must return `503 Service Unavailable` with a descriptive error so the client SDK can retry.

### Scenario 2: Concurrent Subscription Creation Idempotency
- **Given** an active customer and an active subscription plan,
- **When** two identical `POST /v1/subscriptions` requests with the same idempotency key or customer/plan tuple arrive simultaneously,
- **Then** exactly one subscription must be created, and the second request must return `409 Conflict` (or return the existing subscription response without creating a duplicate record or double charge).

### Scenario 3: RBAC Default-Deny on Read Endpoints
- **Given** a service account token possessing only the `event_ingestor` role,
- **When** the token attempts to query `GET /v1/customers`, `GET /v1/invoices`, or `GET /v1/wallets`,
- **Then** the request must be rejected with `403 Forbidden` (`"access denied: insufficient permissions"`).

### Scenario 4: Customer Portal Information Update
- **Given** an end customer authenticated via a valid customer portal session token,
- **When** the customer submits updated billing metadata to `PUT /v1/customer/portal/info`,
- **Then** the request must succeed with `200 OK` and update the customer record, without being denied by internal API-key role checks.

### Scenario 5: Killer Tests (From Card Brief)
- **Killer Test Requirements**: *Unknown* (The prompt supplied the placeholder `[paste the Brief and the Killer Tests from the card]`). The rebuild satisfies Scenarios 1–4 above as the critical durability, concurrency, and security acceptance baselines.
