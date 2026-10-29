#!/bin/bash
# End-to-end test suite for the storefront + members club.
#
# Runs the real app (next build + next start) against a mock AI Gateway and
# a mock Resend, on local JSON files — no Blob, no real emails, no AI spend.
# Needs: node + npm (with node_modules installed in the repo) and python3.
#
#   bash tests/e2e/run-all.sh
#
# Uses /tmp/final (app copy) and /tmp/harness (scripts). Ports 3470 + 4555.
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf /tmp/final /tmp/harness
mkdir -p /tmp/final /tmp/harness
(cd "$REPO" && tar --exclude=node_modules --exclude=.next --exclude=.git -cf - .) | tar -xf - -C /tmp/final
ln -s "$REPO/node_modules" /tmp/final/node_modules
mkdir -p /tmp/final/data
cp "$REPO"/tests/e2e/* /tmp/harness/
echo "Bundle pricing (unit): $(node "$REPO/tests/unit/bundle-pricing.cjs" | tail -1)"
echo "Descriptions keep every word (unit): $(node "$REPO/tests/unit/description-split.cjs" | tail -1)"
node "$REPO/tests/unit/description-split.cjs" >/dev/null 2>&1 || { echo "Description split unit check failed"; exit 1; }
echo "Pacific date boxes (unit): $(node "$REPO/tests/unit/pacific-time.cjs" | tail -1)"
node "$REPO/tests/unit/pacific-time.cjs" >/dev/null 2>&1 || { echo "Pacific time unit check failed"; exit 1; }
echo "Store map styles (unit): $(node "$REPO/tests/unit/map-style.cjs" | tail -1)"
node "$REPO/tests/unit/map-style.cjs" >/dev/null 2>&1 || { echo "Store map style unit check failed"; exit 1; }
echo "Venmo emails: reading, signature, matching (unit): $(node "$REPO/tests/unit/venmo.cjs" | tail -1)"
node "$REPO/tests/unit/venmo.cjs" >/dev/null 2>&1 || { echo "Venmo unit check failed"; exit 1; }
echo "Read-aloud numbers (unit): $(node "$REPO/tests/unit/sayable.cjs" | tail -1)"
node "$REPO/tests/unit/sayable.cjs" >/dev/null 2>&1 || { echo "Read-aloud numbers unit check failed"; exit 1; }
echo "Ambassador numbers (unit): $(node "$REPO/tests/unit/ambassador-stats.cjs" | tail -1)"
node "$REPO/tests/unit/ambassador-stats.cjs" >/dev/null 2>&1 || { echo "Ambassador numbers unit check failed"; exit 1; }
echo "Passkey button wording (unit): $(node "$REPO/tests/unit/unlock-name.cjs" | tail -1)"
node "$REPO/tests/unit/unlock-name.cjs" >/dev/null 2>&1 || { echo "Passkey wording unit check failed"; exit 1; }
echo "Passkey signatures readable (unit): $(node "$REPO/tests/unit/passkey-signature.cjs" | tail -1)"
node "$REPO/tests/unit/passkey-signature.cjs" >/dev/null 2>&1 || { echo "Passkey signature check failed (run npm ci)"; exit 1; }
echo "Daily staff password (unit): $(node "$REPO/tests/unit/staff-phrase.cjs" | tail -1)"
node "$REPO/tests/unit/staff-phrase.cjs" >/dev/null 2>&1 || { echo "Daily staff password unit check failed"; exit 1; }
echo "Staff sign-in lockout per device (unit): $(node "$REPO/tests/unit/rate-limit.cjs" | tail -1)"
node "$REPO/tests/unit/rate-limit.cjs" >/dev/null 2>&1 || { echo "Rate limit unit check failed"; exit 1; }
echo "Cash pickup deals (unit): $(node "$REPO/tests/unit/cash-pricing.cjs" | tail -1)"
node "$REPO/tests/unit/cash-pricing.cjs" >/dev/null 2>&1 || { echo "Cash pickup pricing unit check failed"; exit 1; }
echo "Backorders & restock needs (unit): $(node "$REPO/tests/unit/stock-math.cjs" | tail -1)"
node "$REPO/tests/unit/stock-math.cjs" >/dev/null 2>&1 || { echo "Stock maths unit check failed"; exit 1; }
echo "Safe storage on Blob (unit): $(node "$REPO/tests/unit/versioned-blob.cjs" 2>/dev/null | tail -1)"
node "$REPO/tests/unit/versioned-blob.cjs" >/dev/null 2>&1 || { echo "Safe storage unit check failed"; exit 1; }
echo "Building…"
(cd /tmp/final && npx next build >/tmp/harness/build.log 2>&1) || { echo "Build failed — see /tmp/harness/build.log"; exit 1; }
set +e
FAILED=0
for suite in run.sh:core run2.sh:reliability run3.sh:admin-actions run4.sh:insights run5.sh:messages run6.sh:models run7.sh:foundations run8.sh:analytics run9.sh:features run10.sh:sign-in run11.sh:bundles run12.sh:uploads run13.sh:product-cards run14.sh:concierge-actions run15.sh:launch-hardening run16.sh:member-import; do
  script="${suite%%:*}"; name="${suite##*:}"
  sleep 3
  out="$(bash /tmp/harness/$script 2>&1)"
  line="$(echo "$out" | grep -E '[0-9]+/[0-9]+ passed' | tail -1)"
  echo "$name: ${line:-no result}"
  echo "$out" | grep -E '^FAIL' && FAILED=1
  echo "$out" | grep -qE '([0-9]+)/\1 passed' || FAILED=1
done
[ $FAILED = 0 ] && echo "ALL GREEN" || { echo "SOME TESTS FAILED"; exit 1; }
