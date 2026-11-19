#!/bin/bash
# Ambassador panel suite (lib/ambassadorPanel.ts, /ambassador): linking a member, sign-in landing,
# their own numbers only, no customer details, picks, counters, staff-only terms, the switch.
free_ports() {
  for port in 3470 4555; do
    pids="$(lsof -ti tcp:$port 2>/dev/null) $(fuser $port/tcp 2>/dev/null) $(ss -ltnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | cut -d= -f2)"
    for pid in $pids; do kill "$pid" 2>/dev/null; done
  done
  sleep 0.5
}
free_ports
python3 /tmp/harness/seed.py >/dev/null
rm -rf /tmp/final/data/traffic-*.json
rm -f /tmp/final/data/ambassadors.json /tmp/final/data/audit.jsonl /tmp/final/data/flags-development.json /tmp/final/data/flags-shared.json /tmp/final/data/login-codes.json
rm -rf /tmp/final/data/ambassadors
python3 - <<'PY'
import json,time
D="/tmp/final/data/"; now=int(time.time()*1000)
u=json.load(open(D+"users.json"))
u.append({"id":"u_amy","email":"amy@example.com","name":"Amy Other","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":now-9e8,"approvedAt":now-8e8})
json.dump(u,open(D+"users.json","w"))
PY
node /tmp/harness/tokens.mjs > /tmp/harness/tokens.json
node --input-type=module -e '
import { SignJWT } from "/tmp/final/node_modules/jose/dist/node/esm/index.js";
const key = new TextEncoder().encode("test-secret-at-least-32-characters-long!!");
const t = async (id, as) => new SignJWT({ role: "visitor", userId: id, ...(as ? { as } : {}) }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
console.log(JSON.stringify({ amy: await t("u_amy"), staffAs: await t("u_member", "cam@example.com") }));
' > /tmp/harness/tokens19.json
node /tmp/harness/mockgw.cjs > /tmp/harness/mock.log 2>&1 &
MOCK=$!
cd /tmp/final
TZ=UTC AUTH_SECRET="test-secret-at-least-32-characters-long!!" AI_GATEWAY_API_KEY=test-key AI_GATEWAY_BASE_URL=http://127.0.0.1:4555/v1 RESEND_API_KEY=re_test RESEND_BASE_URL=http://127.0.0.1:4555 INQUIRY_TO_EMAIL=team@example.com npx next start -p 3470 > /tmp/harness/app19.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null localhost:3470/api/assistant/status && break; sleep 0.5; done
python3 /tmp/harness/ambpanel.py
kill $MOCK 2>/dev/null; free_ports
rm -rf /tmp/final/data/traffic-*.json /tmp/final/data/ambassadors
rm -f /tmp/final/data/ambassadors.json /tmp/final/data/audit.jsonl /tmp/final/data/flags-development.json /tmp/final/data/flags-shared.json /tmp/final/data/login-codes.json
