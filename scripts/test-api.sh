#!/usr/bin/env bash
# WhoGoes Public API v1 smoke test (filters + 2-tier pricing + auto-pull surface).
#
# Usage:
#   WG_KEY=wg_xxx WG_BASE=http://localhost:3000 WG_EVENT=modex-2026 ./scripts/test-api.sh
#
# Required env:
#   WG_KEY    - a valid API key (paid user)
#   WG_BASE   - base URL, e.g. http://localhost:3000 or https://app.whogoes.co
#   WG_EVENT  - event slug or UUID that still has unlockable contacts
#
# Optional:
#   WG_EVENT2      - second event slug for the auto-pull rule tests (defaults to WG_EVENT)
#   WG_BAD_KEY     - a bogus key for unauth tests
#   WG_CRON_SECRET - AUTO_PULL_CRON_SECRET; when set, the internal drainer is exercised
#
# NOTE: a full run SPENDS roughly 4 credits on the key's account (unlocks +
# 1 reveal) and leaves those contacts owned.

set -u

WG_KEY="${WG_KEY:-}"
WG_BASE="${WG_BASE:-http://localhost:3000}"
WG_EVENT="${WG_EVENT:-}"
WG_EVENT2="${WG_EVENT2:-$WG_EVENT}"
WG_BAD_KEY="${WG_BAD_KEY:-wg_invalid_xxxxxxxxxxxxxxxxxxxxxxxxxxx}"
WG_CRON_SECRET="${WG_CRON_SECRET:-}"

if [[ -z "$WG_KEY" || -z "$WG_EVENT" ]]; then
  echo "ERROR: set WG_KEY and WG_EVENT env vars. See header of this script." >&2
  exit 2
fi

PASS=0
FAIL=0
SKIP=0
declare -a FAILURES

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
green() { color "32" "$1"; }
red()   { color "31" "$1"; }
gray()  { color "90" "$1"; }

assert_status() {
  local label="$1"; local expected="$2"; local actual="$3"; local body="$4"
  if [[ "$actual" == "$expected" ]]; then
    echo "$(green PASS) [$label] HTTP $actual"
    PASS=$((PASS + 1))
  else
    echo "$(red FAIL) [$label] expected $expected, got $actual"
    echo "  body: $body" | head -c 400
    echo
    FAIL=$((FAIL + 1))
    FAILURES+=("$label")
  fi
}

assert_contains() {
  local label="$1"; local needle="$2"; local haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "$(green PASS) [$label] contains '$needle'"
    PASS=$((PASS + 1))
  else
    echo "$(red FAIL) [$label] did not contain '$needle'"
    echo "  body: $haystack" | head -c 400
    echo
    FAIL=$((FAIL + 1))
    FAILURES+=("$label")
  fi
}

assert_eq() {
  local label="$1"; local a="$2"; local b="$3"
  if [[ "$a" == "$b" ]]; then
    echo "$(green PASS) [$label] $a == $b"
    PASS=$((PASS + 1))
  else
    echo "$(red FAIL) [$label] $a != $b"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label")
  fi
}

skip() {
  echo "$(gray SKIP) [$1] $2"
  SKIP=$((SKIP + 1))
}

call() {
  # call <method> <path> [bearer] [body] [extra header]
  local method="$1"; local path="$2"; local bearer="${3:-}"; local body="${4:-}"; local extra="${5:-}"
  local args=(-s -o /tmp/wgapi-body -D /tmp/wgapi-headers -w "%{http_code}" -X "$method" "$WG_BASE$path")
  if [[ -n "$bearer" ]]; then args+=(-H "Authorization: Bearer $bearer"); fi
  if [[ -n "$body" ]]; then args+=(-H "Content-Type: application/json" -d "$body"); fi
  if [[ -n "$extra" ]]; then args+=(-H "$extra"); fi
  curl "${args[@]}"
}

read_body() { cat /tmp/wgapi-body; }
read_headers() { cat /tmp/wgapi-headers; }

# jsonget <key...>: walk the JSON in /tmp/wgapi-body (arrays by index).
jsonget() {
  python3 - "$@" <<'PYEOF' 2>/dev/null
import json, sys
cur = json.load(open("/tmp/wgapi-body"))
for k in sys.argv[1:]:
    cur = cur[int(k)] if isinstance(cur, list) else cur.get(k)
print(json.dumps(cur) if isinstance(cur, (dict, list, bool)) else cur)
PYEOF
}

echo "=========================================="
echo "WhoGoes API v1 smoke test"
echo "  base:   $WG_BASE"
echo "  event:  $WG_EVENT"
echo "  event2: $WG_EVENT2"
echo "  key:    ${WG_KEY:0:11}..."
echo "=========================================="

# --- 1. Auth + middleware ---
status=$(call GET /api/v1/credits "")
assert_status "1.1 missing auth is 401 not 307" 401 "$status" "$(read_body)"
if grep -qi "^location:" /tmp/wgapi-headers; then
  assert_eq "1.2 no login redirect on API" "no-location" "location-header-present"
else
  assert_eq "1.2 no login redirect on API" "no-location" "no-location"
fi

status=$(call GET /api/v1/credits "$WG_BAD_KEY")
assert_status "1.3 bogus key 401" 401 "$status" "$(read_body)"

# --- 2. Credits ---
status=$(call GET /api/v1/credits "$WG_KEY")
body=$(read_body)
assert_status "2.1 credits 200" 200 "$status" "$body"
assert_contains "2.2 credits has balance" "balance" "$body"
assert_contains "2.3 credits has daily cap state" "spent_today" "$body"
START_BALANCE=$(jsonget data balance)

# --- 3. Events list ---
status=$(call GET "/api/v1/events?limit=5" "$WG_KEY")
body=$(read_body)
assert_status "3.1 events list 200" 200 "$status" "$body"
assert_contains "3.2 events list has event_slug" "event_slug" "$body"
assert_contains "3.3 events list has email counts" "contacts_with_email" "$body"

status=$(call GET "/api/v1/events?q=zz-no-such-event-zz" "$WG_KEY")
assert_eq "3.4 name search narrows" "0" "$(jsonget data total)"

status=$(call GET "/api/v1/events?year=notanumber" "$WG_KEY")
assert_status "3.5 bad year 400" 400 "$status" "$(read_body)"

status=$(call GET "/api/v1/events?status=active&limit=1" "$WG_KEY")
body=$(read_body)
assert_status "3.6 status=active 200" 200 "$status" "$body"
assert_contains "3.7 rows carry status field" '"status":"active"' "$body"

status=$(call GET "/api/v1/events?status=banana" "$WG_KEY")
assert_status "3.8 bad status 400" 400 "$status" "$(read_body)"

# --- 4. Event status ---
status=$(call GET "/api/v1/events/$WG_EVENT/status" "$WG_KEY")
body=$(read_body)
assert_status "4.1 status 200" 200 "$status" "$body"
assert_contains "4.2 status has total_contacts" "total_contacts" "$body"
assert_contains "4.3 status has emails_unlocked" "emails_unlocked" "$body"

status=$(call GET "/api/v1/events/this-slug-does-not-exist/status" "$WG_KEY")
assert_status "4.4 unknown event 404" 404 "$status" "$(read_body)"

# --- 5. Facets ---
status=$(call GET "/api/v1/events/$WG_EVENT/facets" "$WG_KEY")
body=$(read_body)
assert_status "5.1 facets 200" 200 "$status" "$body"
assert_contains "5.2 facets has matched" "matched" "$body"
assert_contains "5.3 facets has owned" "owned" "$body"

status=$(call GET "/api/v1/events/$WG_EVENT/facets?seniority=C-Suite,VP&has_email=true" "$WG_KEY")
assert_status "5.4 facets with filter params 200" 200 "$status" "$(read_body)"

status=$(call GET "/api/v1/events/$WG_EVENT/facets?bogus_key=1&filters=%7B%22bogus%22%3A1%7D" "$WG_KEY")
assert_status "5.5 unknown filter key 400" 400 "$status" "$(read_body)"

status=$(call GET "/api/v1/events/$WG_EVENT/facets?role=ceo" "$WG_KEY")
assert_status "5.6 invalid role value 400" 400 "$status" "$(read_body)"

# --- 6. Preview ---
status=$(call GET "/api/v1/events/$WG_EVENT/preview?limit=3" "$WG_KEY")
body=$(read_body)
assert_status "6.1 preview 200" 200 "$status" "$body"

# --- 7. Unlock validation ---
status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" '{"count": 0}')
assert_status "7.1 count=0 400" 400 "$status" "$(read_body)"

status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" '{"count": 10001}')
assert_status "7.2 count=10001 400" 400 "$status" "$(read_body)"

status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" '{"count": 1, "filters": {"bogus": true}}')
assert_status "7.3 unknown filter key 400" 400 "$status" "$(read_body)"

status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" '{"count": 1, "include_emails": "yes"}')
assert_status "7.4 bad include_emails 400" 400 "$status" "$(read_body)"

# --- 8. Filtered unlock, identities only (1cr per contact) ---
IDEM_KEY="smoke-$(date +%s)-$RANDOM"
status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" \
  '{"count": 2, "filters": {"title_keyword": "a"}, "include_emails": false}' \
  "Idempotency-Key: $IDEM_KEY")
body=$(read_body)
assert_status "8.1 filtered unlock 200" 200 "$status" "$body"
UNLOCK_SPENT=$(jsonget data credits_spent)
UNLOCK_COUNT=$(jsonget data contacts_unlocked)
assert_eq "8.2 identities only: spent == unlocked" "$UNLOCK_SPENT" "$UNLOCK_COUNT"
assert_eq "8.3 no emails revealed" "0" "$(jsonget data emails_revealed)"
assert_eq "8.4 no emails included" "0" "$(jsonget data emails_included)"

# --- 9. Idempotency replay ---
status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" \
  '{"count": 2, "filters": {"title_keyword": "a"}, "include_emails": false}' \
  "Idempotency-Key: $IDEM_KEY")
assert_status "9.1 replay 200" 200 "$status" "$(read_body)"
if grep -qi "^idempotency-replayed: true" /tmp/wgapi-headers; then
  assert_eq "9.2 replay header present" "replayed" "replayed"
else
  assert_eq "9.2 replay header present" "replayed" "missing"
fi
assert_eq "9.3 replay charges nothing (same body)" "$UNLOCK_SPENT" "$(jsonget data credits_spent)"

# --- 10. Read contacts + email gate ---
status=$(call GET "/api/v1/events/$WG_EVENT/contacts?limit=100" "$WG_KEY")
body=$(read_body)
assert_status "10.1 event contacts 200" 200 "$status" "$body"
assert_contains "10.2 payload has email_unlocked" "email_unlocked" "$body"
GATE_VIOLATIONS=$(python3 - <<'PYEOF'
import json
d = json.load(open("/tmp/wgapi-body"))
bad = 0
for c in d["data"]["contacts"]:
    if not c.get("email_unlocked") and c.get("email") is not None:
        bad += 1
print(bad)
PYEOF
)
assert_eq "10.3 locked rows never leak emails" "0" "$GATE_VIOLATIONS"

LOCKED_ID=$(python3 - <<'PYEOF'
import json
d = json.load(open("/tmp/wgapi-body"))
for c in d["data"]["contacts"]:
    if c.get("has_email") and not c.get("email_unlocked"):
        print(c["contact_id"]); break
PYEOF
)

status=$(call GET "/api/v1/events/$WG_EVENT/contacts?sort=bogus" "$WG_KEY")
assert_status "10.4 bad sort 400" 400 "$status" "$(read_body)"

# --- 11. Reveal one email (1cr) ---
if [[ -n "$LOCKED_ID" ]]; then
  status=$(call POST "/api/v1/events/$WG_EVENT/reveal-emails" "$WG_KEY" \
    "{\"contact_ids\": [\"$LOCKED_ID\"]}")
  body=$(read_body)
  assert_status "11.1 reveal 200" 200 "$status" "$body"
  assert_eq "11.2 revealed exactly 1" "1" "$(jsonget data emails_revealed)"
  assert_eq "11.3 charged exactly 1" "1" "$(jsonget data credits_spent)"
  assert_contains "11.4 revealed pair returned" "$LOCKED_ID" "$body"

  status=$(call POST "/api/v1/events/$WG_EVENT/reveal-emails" "$WG_KEY" \
    "{\"contact_ids\": [\"$LOCKED_ID\"]}")
  assert_status "11.5 re-reveal is a no-op 400" 400 "$status" "$(read_body)"
  assert_contains "11.6 no double charge" "No emails to reveal" "$(read_body)"
else
  skip "11.x reveal" "no locked contact with email available"
fi

# --- 12. Global contacts feed ---
status=$(call GET "/api/v1/contacts?since=1970-01-01T00:00:00Z&limit=200" "$WG_KEY")
body=$(read_body)
assert_status "12.1 global feed 200" 200 "$status" "$body"
assert_contains "12.2 watermark present" "watermark" "$body"

status=$(call GET "/api/v1/contacts?since=not-a-date" "$WG_KEY")
assert_status "12.3 bad since 400" 400 "$status" "$(read_body)"

status=$(call GET "/api/v1/contacts?event=$WG_EVENT&limit=5" "$WG_KEY")
assert_status "12.4 event-scoped feed 200" 200 "$status" "$(read_body)"

# --- 13. Scheduled-sync semantics: re-running an unlock only buys newcomers ---
status=$(call POST "/api/v1/events/$WG_EVENT/unlock" "$WG_KEY" \
  '{"count": 1, "filters": {"title_keyword": "a"}, "include_emails": false}')
body=$(read_body)
if [[ "$status" == "200" ]]; then
  assert_eq "13.1 rerun buys only new (1cr)" "1" "$(jsonget data credits_spent)"
else
  assert_contains "13.1 rerun with exhausted pool spends nothing" "No more contacts" "$body"
fi

# Pull-rule surface is withdrawn from the public API (engine kept dormant).
status=$(call POST "/api/v1/pull" "$WG_KEY" '{"dry_run": true}')
assert_status "13.2 /pull removed" 404 "$status" "$(read_body)"

status=$(call GET "/api/v1/auto-pull" "$WG_KEY")
assert_status "13.3 /auto-pull list removed" 404 "$status" "$(read_body)"

status=$(call PUT "/api/v1/auto-pull/$WG_EVENT2" "$WG_KEY" '{"filters": {}}')
assert_status "13.4 /auto-pull PUT removed" 404 "$status" "$(read_body)"

# --- 14. Removed endpoints are gone ---
status=$(call GET "/api/v1/subscriptions" "$WG_KEY")
assert_status "14.1 subscriptions removed" 404 "$status" "$(read_body)"

status=$(call POST "/api/v1/events/$WG_EVENT/contacts" "$WG_KEY" '{"count": 1}')
assert_status "14.2 old unlock POST is 405" 405 "$status" "$(read_body)"

status=$(call GET "/api/v1/contacts/new" "$WG_KEY")
assert_status "14.3 contacts/new removed" 404 "$status" "$(read_body)"

status=$(call POST "/api/v1/contacts/pull" "$WG_KEY" '{}')
assert_status "14.4 contacts/pull removed" 404 "$status" "$(read_body)"

# --- 15. Balance reconciliation ---
status=$(call GET /api/v1/credits "$WG_KEY")
END_BALANCE=$(jsonget data balance)
echo "$(gray INFO) balance moved $START_BALANCE -> $END_BALANCE"

# --- 16. Internal drainer (optional) ---
if [[ -n "$WG_CRON_SECRET" ]]; then
  status=$(call GET "/api/internal/auto-pull?secret=wrong-secret" "")
  assert_status "16.1 drainer wrong secret 401" 401 "$status" "$(read_body)"

  status=$(call GET "/api/internal/auto-pull?secret=$WG_CRON_SECRET" "")
  body=$(read_body)
  assert_status "16.2 drainer runs 200" 200 "$status" "$body"
  assert_contains "16.3 drainer reports processed" "processed" "$body"
else
  skip "16.x drainer" "WG_CRON_SECRET not set"
fi

echo "=========================================="
echo "PASS: $PASS  FAIL: $FAIL  SKIP: $SKIP"
if [[ $FAIL -gt 0 ]]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
echo "$(green "ALL GREEN")"
