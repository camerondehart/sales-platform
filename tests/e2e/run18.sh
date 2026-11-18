#!/bin/bash
# Gift cards suite (lib/giftCards.ts): buying, delivery only on confirmed payment, bonus, balance at checkout.
free_ports() {
  for port in 3470 4555; do
    pids="$(lsof -ti tcp:$port 2>/dev/null) $(fuser $port/tcp 2>/dev/null) $(ss -ltnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | cut -d= -f2)"
    for pid in $pids; do kill "$pid" 2>/dev/null; done
  done
  sleep 0.5
}
free_ports
python3 /tmp/harness/seed.py >/dev/null
rm -f /tmp/final/data/gift-cards.json /tmp/final/data/stock.json /tmp/final/data/audit.jsonl /tmp/final/data/flags-development.json /tmp/final/data/flags-shared.json /tmp/final/data/venmo-payments.json
python3 - <<'PY'
import json,time
D="/tmp/final/data/"; now=int(time.time()*1000)
u=json.load(open(D+"users.json"))
u.append({"id":"u_rob","email":"rob@example.com","name":"Rob Recipient","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":now-9e8,"approvedAt":now-8e8})
u.append({"id":"u_kim","email":"kim@example.com","name":"Kim Claimer","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":now-9e8,"approvedAt":now-8e8})
json.dump(u,open(D+"users.json","w"))
json.dump({"loyaltyEnabled":True,"pointsPerDollar":1,"pointsPerDollarRedeemed":100,"minPointsToRedeem":100},open(D+"settings.json","w"))
PY
node /tmp/harness/tokens.mjs > /tmp/harness/tokens.json
node --input-type=module -e '
import { SignJWT } from "/tmp/final/node_modules/jose/dist/node/esm/index.js";
const key = new TextEncoder().encode("test-secret-at-least-32-characters-long!!");
const t = async (id) => new SignJWT({ role: "visitor", userId: id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
console.log(JSON.stringify({ rob: await t("u_rob"), kim: await t("u_kim") }));
' > /tmp/harness/tokens18.json
node /tmp/harness/mockgw.cjs > /tmp/harness/mock.log 2>&1 &
MOCK=$!
cd /tmp/final
TZ=UTC AUTH_SECRET="test-secret-at-least-32-characters-long!!" AI_GATEWAY_API_KEY=test-key AI_GATEWAY_BASE_URL=http://127.0.0.1:4555/v1 RESEND_API_KEY=re_test RESEND_BASE_URL=http://127.0.0.1:4555 INQUIRY_TO_EMAIL=team@example.com RESEND_WEBHOOK_SECRET=whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQxMjM0NTY= npx next start -p 3470 > /tmp/harness/app18.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null localhost:3470/api/assistant/status && break; sleep 0.5; done
python3 /tmp/harness/giftcards.py
kill $MOCK 2>/dev/null; free_ports
rm -f /tmp/final/data/gift-cards.json /tmp/final/data/settings.json /tmp/final/data/audit.jsonl /tmp/final/data/flags-development.json /tmp/final/data/flags-shared.json /tmp/final/data/venmo-payments.json
