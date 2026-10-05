# API.md — REST API Interface Specification

This document details all routes, payloads, authorization requirements, and error states for our billing engine rebuild.

---

## 1. Authentication & API Key Management

### `POST /v1/auth/signup`
- **What it does**: Registers a new organization, root administrator, and bootstraps the default development environment.
- **Input**: `{ "email": "admin@example.com", "password": "securepassword", "tenant_name": "Acme Inc" }`
- **Output**: `200 OK` `{ "token": "jwt_token", "user_id": "user_123", "tenant_id": "tenant_123" }`
- **Who may call it**: Anyone (Public guest route).
- **Errors**: `400 Bad Request` (invalid email or password < 8 chars), `409 Conflict` (tenant/user already exists).

### `POST /v1/auth/login`
- **What it does**: Authenticates an administrator and returns a JWT access token.
- **Input**: `{ "email": "admin@example.com", "password": "securepassword" }`
- **Output**: `200 OK` `{ "token": "jwt_token", "user_id": "user_123", "tenant_id": "tenant_123" }`
- **Who may call it**: Anyone (Public guest route).
- **Errors**: `400 Bad Request`, `401 Unauthorized` (invalid credentials).

### `POST /v1/secrets/api/keys`
- **What it does**: Provisions a new secret API key scoped to the environment.
- **Input**: `{ "name": "Ingestion Worker Key", "roles": ["event_ingestor"], "type": "API_KEY" }`
- **Output**: `201 Created` `{ "id": "sec_123", "api_key": "fp_live_...", "name": "Ingestion Worker Key" }`
- **Who may call it**: Authenticated `super_admin` only.
- **Errors**: `401 Unauthorized`, `403 Forbidden`, `400 Bad Request`.

---

## 2. Catalog & Metering

### `POST /v1/meters`
- **What it does**: Creates an aggregation formula for incoming usage telemetry.
- **Input**: `{ "name": "API Compute Units", "event_name": "api_call", "aggregation_type": "SUM", "value_property": "duration_ms" }`
- **Output**: `201 Created` `{ "id": "meter_123", "event_name": "api_call", ... }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request` (unsupported aggregation type), `401 Unauthorized`, `403 Forbidden`.

### `GET /v1/meters`
- **What it does**: Lists meters defined within the current environment.
- **Input**: None (query parameters: `limit`, `offset`).
- **Output**: `200 OK` `{ "items": [ { "id": "meter_123", ... } ] }`
- **Who may call it**: `all_reader`, `all_writer`, `super_admin`.
- **Errors**: `401 Unauthorized`, `403 Forbidden`.

### `POST /v1/prices`
- **What it does**: Creates a price rate card linked to a meter or flat subscription fee.
- **Input**: `{ "amount": "0.005", "currency": "USD", "type": "USAGE", "billing_model": "TIERED_GRADUATED", "meter_id": "meter_123", "tiers": [...] }`
- **Output**: `201 Created` `{ "id": "price_123", ... }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`.

### `POST /v1/plans`
- **What it does**: Bundles prices into a marketable subscription plan.
- **Input**: `{ "name": "Pro Tier", "lookup_key": "plan_pro", "price_ids": ["price_123"] }`
- **Output**: `201 Created` `{ "id": "plan_123", "lookup_key": "plan_pro", ... }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request`, `409 Conflict` (duplicate lookup key).

---

## 3. Customers & Subscriptions

### `POST /v1/customers`
- **What it does**: Registers a customer account under the active tenant and environment.
- **Input**: `{ "external_id": "cust_ext_456", "name": "Stripe Corp", "email": "billing@stripe.com", "currency": "USD" }`
- **Output**: `201 Created` `{ "id": "cust_123", "external_id": "cust_ext_456", ... }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request`, `409 Conflict` (duplicate `external_id`).

### `GET /v1/customers/:id`
- **What it does**: Retrieves customer profile details.
- **Input**: Path parameter `:id` (internal ID or lookup key).
- **Output**: `200 OK` `{ "id": "cust_123", "external_id": "cust_ext_456", ... }`
- **Who may call it**: `all_reader`, `all_writer`, `super_admin`.
- **Errors**: `401 Unauthorized`, `403 Forbidden` (strictly enforced in rebuild), `404 Not Found`.

### `POST /v1/subscriptions`
- **What it does**: Creates a subscription attaching a customer to a plan.
- **Input**: `{ "customer_id": "cust_123", "plan_id": "plan_123", "currency": "USD", "billing_period": "month", "idempotency_key": "sub_tx_789" }`
- **Output**: `201 Created` `{ "id": "sub_123", "subscription_status": "active", ... }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request`, `404 Not Found` (customer or plan inactive), `409 Conflict` (active subscription already exists for plan or duplicate idempotency key).

---

## 4. Usage Event Ingestion

### `POST /v1/events`
- **What it does**: Ingests a single real-time usage consumption event.
- **Input**: `{ "event_name": "api_call", "customer_id": "cust_ext_456", "timestamp": "2026-10-05T20:00:00Z", "properties": { "duration_ms": 150 } }`
- **Output**: `202 Accepted` `{ "message": "Event accepted for processing", "event_id": "evt_123" }`
- **Who may call it**: `event_ingestor`, `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request` (missing required event fields), `413 Payload Too Large`, `503 Service Unavailable` (broker publish failed; client must retry).

### `POST /v1/events/bulk`
- **What it does**: Batched usage event ingestion.
- **Input**: `{ "events": [ { "event_name": "api_call", ... }, ... ] }`
- **Output**: `202 Accepted` `{ "message": "Events accepted for processing", "count": 50 }`
- **Who may call it**: `event_ingestor`, `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request`, `413 Payload Too Large`, `503 Service Unavailable`.

---

## 5. Invoicing & Document Delivery

### `POST /v1/invoices/:id/compute`
- **What it does**: Rates all unbilled events from ClickHouse for the period and recalculates draft line items.
- **Input**: None (optional override parameters in body).
- **Output**: `200 OK` `{ "id": "inv_123", "invoice_status": "DRAFT", "amount_due": "42.50", "line_items": [...] }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request`, `404 Not Found`.

### `POST /v1/invoices/:id/finalize`
- **What it does**: Transitions a draft invoice to `FINALIZED`, locking line items against edits.
- **Input**: None.
- **Output**: `200 OK` `{ "id": "inv_123", "invoice_status": "FINALIZED", "finalized_at": "..." }`
- **Who may call it**: `all_writer`, `super_admin`.
- **Errors**: `400 Bad Request` (invoice not in `DRAFT` status), `404 Not Found`.

### `GET /v1/invoices/:id/pdf`
- **What it does**: Compiles and streams the Typst vector PDF document for the invoice.
- **Input**: None (query `url=true` returns presigned S3 URL; default returns binary stream).
- **Output**: `200 OK` with `Content-Type: application/pdf` binary stream.
- **Who may call it**: `all_reader`, `all_writer`, `super_admin`.
- **Errors**: `404 Not Found`, `500 Internal Error` (Typst compilation failure).

---

## 6. Customer Portal (Self-Service)

### `GET /v1/customer/portal/info`
- **What it does**: Returns the authenticated customer's profile and billing contact.
- **Input**: None (Bearer session token in `Authorization` header).
- **Output**: `200 OK` `{ "id": "cust_123", "name": "Stripe Corp", "email": "billing@stripe.com" }`
- **Who may call it**: Valid Customer Portal Session Token.
- **Errors**: `401 Unauthorized` (expired or invalid session token).

### `PUT /v1/customer/portal/info`
- **What it does**: Allows end customer to update billing address and contact details.
- **Input**: `{ "name": "Stripe Corp", "address_line1": "510 Townsend St", ... }`
- **Output**: `200 OK` `{ "id": "cust_123", "name": "Stripe Corp", ... }`
- **Who may call it**: Valid Customer Portal Session Token (no internal staff RBAC check).
- **Errors**: `400 Bad Request`, `401 Unauthorized`.
