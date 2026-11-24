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
# Keep Next's build cache between runs (build ~22s -> ~9s). CLEAN=1 bash tests/e2e/run-all.sh
# (or --clean) builds from scratch instead.
[ "$1" = "--clean" ] && CLEAN=1
rm -rf /tmp/next-cache-keep
[ "${CLEAN:-0}" != 1 ] && [ -d /tmp/final/.next/cache ] && mv /tmp/final/.next/cache /tmp/next-cache-keep
rm -rf /tmp/final /tmp/harness
mkdir -p /tmp/final /tmp/harness
(cd "$REPO" && tar --exclude=node_modules --exclude=.next --exclude=.git -cf - .) | tar -xf - -C /tmp/final
ln -s "$REPO/node_modules" /tmp/final/node_modules
mkdir -p /tmp/final/data
cp "$REPO"/tests/e2e/* /tmp/harness/
# Each unit check runs once: print its last line, stop the suite if it failed.
unit() {
  local label="$1" file="$2" msg="$3" res rc
  if [ "$4" = quiet ]; then res="$(node "$REPO/tests/unit/$file" 2>/dev/null)" && rc=0 || rc=$?
  else res="$(node "$REPO/tests/unit/$file")" && rc=0 || rc=$?; fi
  echo "$label: $(echo "$res" | tail -1)"
  [ $rc = 0 ] || { echo "$msg"; exit 1; }
}
echo "Bundle pricing (unit): $(node "$REPO/tests/unit/bundle-pricing.cjs" | tail -1)"
unit "Descriptions keep every word (unit)" description-split.cjs "Description split unit check failed"
unit "Pacific date boxes (unit)" pacific-time.cjs "Pacific time unit check failed"
unit "Store map styles (unit)" map-style.cjs "Store map style unit check failed"
unit "Venmo emails: reading, signature, matching (unit)" venmo.cjs "Venmo unit check failed"
unit "Read-aloud numbers (unit)" sayable.cjs "Read-aloud numbers unit check failed"
unit "Ambassador numbers (unit)" ambassador-stats.cjs "Ambassador numbers unit check failed"
unit "Passkey button wording (unit)" unlock-name.cjs "Passkey wording unit check failed"
unit "Passkey signatures readable (unit)" passkey-signature.cjs "Passkey signature check failed (run npm ci)"
unit "Daily staff password (unit)" staff-phrase.cjs "Daily staff password unit check failed"
unit "Seasonal entrance schedule (unit)" entrance-themes.cjs "Seasonal entrance unit check failed"
unit "Staff sign-in lockout per device (unit)" rate-limit.cjs "Rate limit unit check failed"
unit "Cash pickup deals (unit)" cash-pricing.cjs "Cash pickup pricing unit check failed"
unit "Percentage discounts cap at \$100 (unit)" percent-cap.cjs "Percent cap unit check failed"
unit "Backorders & restock needs (unit)" stock-math.cjs "Stock maths unit check failed"
unit "Suspicious activity signals (unit)" suspicion.cjs "Suspicious activity unit check failed"
unit "Safe storage on Blob (unit)" versioned-blob.cjs "Safe storage unit check failed" quiet
unit "Order files never skipped (unit)" fetch-all.cjs "Order file loading unit check failed"
unit "Events note for locals (unit)" local-events.cjs "Events note unit check failed"
unit "Gift card bonus and balance (unit)" gift-cards.cjs "Gift card unit check failed"
unit "Label log shipping numbers (unit)" label-log.cjs "Label log unit check failed"
unit "Ambassador panel ranges and chart (unit)" ambassador-panel.cjs "Ambassador panel unit check failed"
unit "Banner HTML can't run scripts (unit)" safe-html.cjs "Banner HTML unit check failed"
unit "Sign-in map daily town totals (unit)" login-places.cjs "Sign-in map unit check failed"
unit "Night sky on the visitor's own clock (unit)" night-sky.cjs "Night sky unit check failed"
unit "Scheduled sitewide sales (unit)" site-sales.cjs "Sitewide sales unit check failed"
if [ -d /tmp/next-cache-keep ]; then mkdir -p /tmp/final/.next && mv /tmp/next-cache-keep /tmp/final/.next/cache; echo "Building (cached; --clean for a fresh build)…"; else echo "Building…"; fi
(cd /tmp/final && npx next build >/tmp/harness/build.log 2>&1) || { echo "Build failed — see /tmp/harness/build.log"; exit 1; }
set +e
FAILED=0
for suite in run.sh:core run2.sh:reliability run3.sh:admin-actions run4.sh:insights run5.sh:messages run6.sh:models run7.sh:foundations run8.sh:analytics run9.sh:features run10.sh:sign-in run11.sh:bundles run12.sh:uploads run13.sh:product-cards run14.sh:concierge-actions run15.sh:launch-hardening run16.sh:member-import run17.sh:retail-stores run18.sh:gift-cards run19.sh:ambassador-panel; do
  script="${suite%%:*}"; name="${suite##*:}"
  # Wait (up to 10s) until the last suite's ports are free, instead of a fixed 3s pause.
  for i in $(seq 1 100); do
    (exec 3<>/dev/tcp/127.0.0.1/3470) 2>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/4555) 2>/dev/null || break
    sleep 0.1
  done
  out="$(bash /tmp/harness/$script 2>&1)"
  line="$(echo "$out" | grep -E '[0-9]+/[0-9]+ passed' | tail -1)"
  echo "$name: ${line:-no result}"
  echo "$out" | grep -E '^FAIL' && FAILED=1
  echo "$out" | grep -qE '([0-9]+)/\1 passed' || FAILED=1
done
[ $FAILED = 0 ] && echo "ALL GREEN" || { echo "SOME TESTS FAILED"; exit 1; }
