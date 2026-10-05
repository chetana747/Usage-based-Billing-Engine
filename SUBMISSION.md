Team ID:  [DBG-249]
Team:     [LOCKIN]
Card:     Usage-Based Metering & Billing Engine (Flexprice Rebuild)
Original: https://github.com/flexprice/flexprice
Commit studied: main (release v2.0.3)
Run:      cp .env.example .env && docker compose up -d && go run cmd/migrate/main.go up && go run cmd/server/main.go
Improvements we built:
  1. Fix: Guaranteed Event Delivery with Synchronous Broker Backpressure — Replaced silent event drops during Kafka/broker outages with synchronous partition acknowledgment, surfacing HTTP 503 with Retry-After headers instead of returning misleading 202 Accepted.
  2. Differentiator: Complete Default-Deny RBAC & Idempotent Subscription Lifecycle — Enforced strict read(...) permission gating across all query endpoints to prevent low-privilege tokens from harvesting tenant data, paired with PostgreSQL row-level advisory locks and composite partial unique indexes on active subscriptions to prevent race conditions and duplicate Temporal cron workflows.
Libraries / AI used:
  - Gin (github.com/gin-gonic/gin): High-performance HTTP REST routing, middleware pipeline, and JSON serialization.
  - Ent (entgo.io/ent): Type-safe ORM for PostgreSQL transactional data modeling and migrations.
  - Watermill (github.com/ThreeDotsLabs/watermill): Event-driven messaging abstraction for Apache Kafka streaming.
  - ClickHouse Go (github.com/ClickHouse/clickhouse-go/v2): High-throughput columnar aggregation on usage telemetry events.
  - Temporal (go.temporal.io/sdk): Distributed workflow orchestration for subscription billing cron cycles.
  - Google Antigravity AI: Static codebase audit, vulnerability verification, and architectural documentation.
Deck:     deck.pdf (repo root)
