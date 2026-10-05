# Flexprice Engine Rebuild

> Production-grade, usage-based metering and billing engine with guaranteed event delivery, strict default-deny RBAC, and idempotent subscription workflows.

---

## ⚡ Quickstart (Run in 5 Commands or Fewer)

Get the entire stack (PostgreSQL, ClickHouse, Kafka, Temporal, and the Flexprice Engine) running locally:

```bash
# 1. Clone your repository and enter directory
git clone <your-repo-url> && cd <your-repo-name>

# 2. Copy the environment configuration
cp .env.example .env

# 3. Start all backing infrastructure services in background
docker compose up -d postgres clickhouse kafka zookeeper temporal

# 4. Run database migrations
go run cmd/migrate/main.go up

# 5. Start the Flexprice API server
go run cmd/server/main.go
```

The API server will be live and ready to accept requests at `http://localhost:8080`.

---

## 📚 Documentation Index

All architectural specifications, reverse-engineering observations, schemas, and API contracts are fully documented in the [`docs/`](docs/) directory:

| Document | Description |
|---|---|
| [**`docs/OBSERVATIONS.md`**](docs/OBSERVATIONS.md) | Verified factual claims about the original codebase with exact `file:line` citations. |
| [**`docs/PRD.md`**](docs/PRD.md) | Problem statement, target user, core billing flow, MoSCoW feature ranking, and Given/When/Then acceptance criteria. |
| [**`docs/ARCHITECTURE.md`**](docs/ARCHITECTURE.md) | Rebuild system topology, Mermaid architecture diagram, external services, state locations, and key engineering decisions. |
| [**`docs/DATA_MODEL.md`**](docs/DATA_MODEL.md) | Relational PostgreSQL schemas, ClickHouse telemetry tables, constraints, indexes, and Mermaid `erDiagram`. |
| [**`docs/API.md`**](docs/API.md) | Complete REST API contract: methods, paths, request payloads, response schemas, RBAC roles, and error codes. |
| [**`docs/GAPS.md`**](docs/GAPS.md) | Exhaustive catalog of verified bugs in the original engine, plus specifications of the **2 Core Improvements**. |
| [**`docs/AGENT_LOG.md`**](docs/AGENT_LOG.md) | Chronological log of key prompts, audit steps, and line-by-line verification corrections. |

---

## 🚀 Key Improvements in This Rebuild

This rebuild eliminates the critical architectural flaws discovered in the original system:

1. **Guaranteed Event Delivery with Synchronous Broker Acks**
   - *Original Flaw*: Swallowed Kafka errors and returned HTTP `202 Accepted` during broker downtime, permanently losing billable telemetry events ([internal/ee/service/event.go:75](internal/ee/service/event.go#L75)).
   - *Rebuild Fix*: Synchronous partition acknowledgment. Returns HTTP `503 Service Unavailable` with `Retry-After` headers if the message broker is unavailable, preventing revenue leakage.

2. **Complete Default-Deny RBAC & Idempotent Subscriptions**
   - *Original Flaw*: Entity read routes (`GET /v1/*`) completely omitted RBAC permission middleware, allowing low-privilege keys to read tenant records ([internal/api/router.go:211](internal/api/router.go#L211)). Subscription creation lacked idempotency, resulting in duplicate billing workflows ([internal/ee/service/subscription.go:77](internal/ee/service/subscription.go#L77)).
   - *Rebuild Fix*: Mandatory `read(...)` permission gating across all query endpoints, customer portal token isolation, and PostgreSQL row-level advisory locking with composite partial unique indexes on active subscriptions.

---

## 🛠️ Tech Stack & Infrastructure

- **Language**: Go 1.23+
- **HTTP Web Framework**: Gin (`github.com/gin-gonic/gin`)
- **Metadata Database**: PostgreSQL 17 (managed with Ent ORM)
- **High-Throughput Metering Store**: ClickHouse 24.9
- **Event Streaming**: Apache Kafka (via Watermill publisher/subscriber)
- **Workflow Orchestration**: Temporal 1.26
- **PDF Generation**: Typst CLI engine
- **Payment Providers**: Stripe & Razorpay SDKs

---

## 🧪 Testing & Verification

Run the full test suite, including unit tests, RBAC access-control checks, and idempotency race condition tests:

```bash
# Run unit and integration tests
go test -v -race ./...

# Verify RBAC permission rules across all endpoints
go test -v ./internal/api/middleware/... -run TestRBACPermissions

# Verify event ingestion broker backpressure
go test -v ./internal/service/... -run TestEventIngestionBrokerFailure
```

---

## 🔒 Environment Configuration

See [`.env.example`](.env.example) for all available environment variables and configuration options (PostgreSQL connection strings, ClickHouse DSN, Kafka brokers, Temporal host, and JWT secrets). No real secrets are committed.
