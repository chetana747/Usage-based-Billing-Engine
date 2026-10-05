#!/usr/bin/env bash
set -euo pipefail

# ---------------------------
# USER CONFIG
# ---------------------------
CH_HOST="${CH_HOST:-127.0.0.1}"
CH_PORT="${CH_PORT:-9000}"
CH_USER="${CH_USER:-default}"
CH_PASSWORD="${CH_PASSWORD:-}"
CH_DB="${CH_DB:-flexprice}"
TENANT_ID="${TENANT_ID:-}"
ENVIRONMENT_ID="${ENVIRONMENT_ID:-}"

# Month range to process: YYYY-MM format, inclusive on both ends
START_MONTH="${START_MONTH:-2026-03}"
END_MONTH="${END_MONTH:-2026-03}"

# JSON file of external_customer_ids to process (array of strings)
# Default: single smoke-test customer; override with full list for production
CUSTOMER_IDS_FILE="${CUSTOMER_IDS_FILE:-}"

# Inline fallback if no file provided (smoke-test customer)
INLINE_CUSTOMER_IDS=(
  # Add external_customer_ids here for a quick smoke test,
  # or set CUSTOMER_IDS_FILE to a JSON array file for production runs.
  # Example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
)

# Mutation monitoring
MUTATION_POLL_SEC="${MUTATION_POLL_SEC:-30}"
MUTATION_TIMEOUT_SEC="${MUTATION_TIMEOUT_SEC:-7200}"   # 2h max per month

LOG_DIR="${LOG_DIR:-./logs/backfill_billable_tokens}"
mkdir -p "$LOG_DIR"

# ---------------------------
# Build SQL IN(...) list from file or inline array
# ---------------------------
build_customer_in() {
  if [[ -n "$CUSTOMER_IDS_FILE" && -f "$CUSTOMER_IDS_FILE" ]]; then
    # Parse JSON array: ["id1","id2",...] → 'id1','id2',...
    jq -r '.[]' "$CUSTOMER_IDS_FILE" | sed "s/.*/'&'/" | paste -s -d, -
  else
    printf "'%s'," "${INLINE_CUSTOMER_IDS[@]}" | sed 's/,$//'
  fi
}

CUSTOMER_IN="$(build_customer_in)"
CUSTOMER_COUNT=$(echo "$CUSTOMER_IN" | tr ',' '\n' | wc -l | tr -d ' ')

# ---------------------------
# ClickHouse client wrapper
# ---------------------------
ch() {
  clickhouse client \
    --host "$CH_HOST" --port "$CH_PORT" \
    --user "$CH_USER" --password "$CH_PASSWORD" \
    --database "$CH_DB" \
    --connect_timeout 10 \
    --send_timeout 60 \
    --receive_timeout 300 \
    --multiquery \
    --format=TSV \
    "$@"
}

# ---------------------------
# Helpers
# ---------------------------
month_add() {
  gdate -d "${1}-01 +1 month" +"%Y-%m"
}

log() {
  local month_log="$1"; shift
  echo "[$(gdate -Iseconds)] $*" | tee -a "$month_log"
}

# ---------------------------
# Wait for all pending mutations on flexprice.events
# ---------------------------
wait_for_mutations() {
  local month_log="$1"
  local elapsed=0

  log "$month_log" "Waiting for mutation to complete (polling every ${MUTATION_POLL_SEC}s)..."

  while true; do
    pending=$(ch --query "
      SELECT countIf(is_done = 0)
      FROM system.mutations
      WHERE database = '${CH_DB}' AND table = 'events' AND is_done = 0
    " 2>/dev/null | tr -d '\r\n ')

    fail_reason=$(ch --query "
      SELECT latest_fail_reason
      FROM system.mutations
      WHERE database = '${CH_DB}' AND table = 'events'
        AND latest_fail_reason != ''
      ORDER BY create_time DESC
      LIMIT 1
    " 2>/dev/null | tr -d '\r\n')

    if [[ -n "$fail_reason" ]]; then
      log "$month_log" "ERROR: Mutation failed — $fail_reason"
      log "$month_log" "Run: SYSTEM STOP MUTATIONS flexprice.events  to halt further execution."
      return 1
    fi

    if [[ "$pending" == "0" ]]; then
      log "$month_log" "Mutation complete."
      return 0
    fi

    log "$month_log" "  Still running — ${pending} mutation(s) pending, ${elapsed}s elapsed..."
    sleep "$MUTATION_POLL_SEC"
    elapsed=$(( elapsed + MUTATION_POLL_SEC ))

    if (( elapsed >= MUTATION_TIMEOUT_SEC )); then
      log "$month_log" "TIMEOUT: mutation did not finish within ${MUTATION_TIMEOUT_SEC}s"
      return 1
    fi
  done
}

# ---------------------------
# Process one calendar month
# ---------------------------
process_month() {
  local month="$1"
  local month_start="${month}-01"
  local month_end; month_end="$(month_add "$month")-01"
  local month_log="${LOG_DIR}/${month}.log"

  log "$month_log" "=== ${month} | range: [${month_start}, ${month_end}) | customers: ${CUSTOMER_COUNT} ==="

  # Count rows that need updating (promptTokens present, billablePromptTokens not yet set)
  local needs_update
  needs_update=$(ch --query "
    SELECT count()
    FROM flexprice.events
    WHERE tenant_id         = '${TENANT_ID}'
      AND environment_id    = '${ENVIRONMENT_ID}'
      AND external_customer_id IN (${CUSTOMER_IN})
      AND timestamp >= '${month_start} 00:00:00'
      AND timestamp <  '${month_end} 00:00:00'
      AND JSONHas(properties, 'promptTokens')         = 1
      AND JSONHas(properties, 'billablePromptTokens') = 0
  " 2>/dev/null | tr -d '\r\n ')

  log "$month_log" "Rows needing update: ${needs_update}"

  if [[ "$needs_update" == "0" ]]; then
    log "$month_log" "SKIP — already backfilled or no matching rows for ${month}."
    return 0
  fi

  # Submit the mutation
  # replaceRegexpOne replaces the trailing } (end-of-JSON) with ,new_field"}
  # Pattern }\\s*\$ = literal } then optional whitespace then end-of-string
  # cachedPromptTokens treated as 0 when absent (toInt64OrZero)
  log "$month_log" "Submitting mutation for ${needs_update} rows..."

  ch --query "
    ALTER TABLE flexprice.events
    UPDATE properties = replaceRegexpOne(
        properties,
        '}\\s*\$',
        concat(
            ',\"billablePromptTokens\":\"',
            toString(
                toInt64OrZero(JSONExtractString(properties, 'promptTokens')) -
                toInt64OrZero(JSONExtractString(properties, 'cachedPromptTokens'))
            ),
            '\"}'
        )
    )
    WHERE tenant_id         = '${TENANT_ID}'
      AND environment_id    = '${ENVIRONMENT_ID}'
      AND external_customer_id IN (${CUSTOMER_IN})
      AND timestamp >= '${month_start} 00:00:00'
      AND timestamp <  '${month_end} 00:00:00'
      AND JSONHas(properties, 'promptTokens')         = 1
      AND JSONHas(properties, 'billablePromptTokens') = 0
  " 2>>"$month_log"

  log "$month_log" "Mutation submitted. Waiting..."
  wait_for_mutations "$month_log"

  # Post-check
  local remaining
  remaining=$(ch --query "
    SELECT count()
    FROM flexprice.events
    WHERE tenant_id         = '${TENANT_ID}'
      AND environment_id    = '${ENVIRONMENT_ID}'
      AND external_customer_id IN (${CUSTOMER_IN})
      AND timestamp >= '${month_start} 00:00:00'
      AND timestamp <  '${month_end} 00:00:00'
      AND JSONHas(properties, 'promptTokens')         = 1
      AND JSONHas(properties, 'billablePromptTokens') = 0
  " 2>/dev/null | tr -d '\r\n ')

  if [[ "$remaining" == "0" ]]; then
    log "$month_log" "OK — all rows updated for ${month}."
  else
    log "$month_log" "WARNING — ${remaining} rows still missing billablePromptTokens."
    log "$month_log" "  This can be ReplacingMergeTree merge lag. Re-running the script is safe (idempotent)."
  fi
}

# ---------------------------
# MAIN
# ---------------------------
echo "=================================================="
echo "Backfill: billablePromptTokens"
echo "Tenant:      ${TENANT_ID}"
echo "Environment: ${ENVIRONMENT_ID}"
echo "Customers:   ${CUSTOMER_COUNT} IDs"
echo "Range:       ${START_MONTH} → ${END_MONTH} (inclusive)"
echo "Logs:        ${LOG_DIR}"
echo "=================================================="
echo ""

export CH_HOST CH_PORT CH_USER CH_PASSWORD CH_DB TENANT_ID ENVIRONMENT_ID
export CUSTOMER_IN CUSTOMER_COUNT MUTATION_POLL_SEC MUTATION_TIMEOUT_SEC LOG_DIR

current="$START_MONTH"
while [[ "$current" < "$END_MONTH" || "$current" == "$END_MONTH" ]]; do
  process_month "$current"
  current="$(month_add "$current")"
done

echo ""
echo "All months processed. Logs: ${LOG_DIR}"


: '
==================================================
USAGE
==================================================

Smoke test — one customer, March 2026 (default):
  source scripts/bash/.env.backfill && \
    bash scripts/bash/backfill_billable_prompt_tokens.sh

Smoke test — explicit override:
  source scripts/bash/.env.backfill && \
    START_MONTH=2026-03 END_MONTH=2026-03 \
    bash scripts/bash/backfill_billable_prompt_tokens.sh

Full run — all 400 customers, full period (point at JSON file):
  source scripts/bash/.env.backfill && \
    CUSTOMER_IDS_FILE=scripts/bash/enterprise-customer-ids.json \
    START_MONTH=2025-01 END_MONTH=2026-04 \
    bash scripts/bash/backfill_billable_prompt_tokens.sh

Monitor mutations live (separate terminal):
  source scripts/bash/.env.backfill && \
    clickhouse client \
      --host "$CH_HOST" --port "$CH_PORT" \
      --user "$CH_USER" --password "$CH_PASSWORD" \
      --query "
        SELECT mutation_id, substring(command,1,80) AS cmd,
               parts_to_do, parts_done, is_done, latest_fail_reason
        FROM system.mutations
        WHERE table = '"'"'events'"'"'
        ORDER BY create_time DESC LIMIT 5
      "

Emergency stop:
  source scripts/bash/.env.backfill && \
    clickhouse client \
      --host "$CH_HOST" --port "$CH_PORT" \
      --user "$CH_USER" --password "$CH_PASSWORD" \
      --query "SYSTEM STOP MUTATIONS flexprice.events"

Resume after stop:
  source scripts/bash/.env.backfill && \
    clickhouse client \
      --host "$CH_HOST" --port "$CH_PORT" \
      --user "$CH_USER" --password "$CH_PASSWORD" \
      --query "SYSTEM START MUTATIONS flexprice.events"

==================================================
CONFIGURABLE ENVIRONMENT VARIABLES
==================================================

Connection (set via .env.backfill):
  CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DB
  TENANT_ID, ENVIRONMENT_ID

Date range:
  START_MONTH       YYYY-MM, inclusive (default: 2026-03)
  END_MONTH         YYYY-MM, inclusive (default: 2026-03)

Customer list:
  CUSTOMER_IDS_FILE Path to JSON array of external_customer_ids
                    (default: uses INLINE_CUSTOMER_IDS in the script)

Execution:
  MUTATION_POLL_SEC     Seconds between status polls (default: 30)
  MUTATION_TIMEOUT_SEC  Max wait per month in seconds (default: 7200)
  LOG_DIR               Log directory (default: ./logs/backfill_billable_tokens)

==================================================
'
