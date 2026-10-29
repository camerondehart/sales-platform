#!/bin/bash
# Free the test ports by PORT (killing "next start" leaves its next-server child running).
free_ports() {
  for port in 3470 4555; do
    # lsof works on macOS, fuser/ss on Linux — use whichever sees the process.
    pids="$(lsof -ti tcp:$port 2>/dev/null) $(fuser $port/tcp 2>/dev/null) $(ss -ltnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | cut -d= -f2)"
    for pid in $pids; do kill "$pid" 2>/dev/null; done
  done
  sleep 0.5
}
free_ports
python3 /tmp/harness/seed.py >/dev/null
python3 -c "import json;p='/tmp/final/data/products.json';d=json.load(open(p));d.append({'id':'p_ask','name':'Ask About Me','description':'Priced on request.','price':'Inquire','image':'x','category':'Special','visibility':'both','createdAt':3});json.dump(d,open(p,'w'))"
rm -rf /tmp/final/data/transcripts /tmp/final/data/traffic-*.json /tmp/final/data/campaigns.json /tmp/final/data/reminder-*.json /tmp/final/data/assistant-sources.json /tmp/final/data/login-codes.json /tmp/final/data/admins.json /tmp/final/data/bundles.json /tmp/final/data/media-deleted.log
rm -f /tmp/final/data/audit.jsonl /tmp/final/data/flags-development.json /tmp/final/data/flags-shared.json /tmp/final/data/email-templates.json /tmp/final/data/stock.json /tmp/final/data/venmo-payments.json /tmp/final/data/inbound-setup.json /tmp/final/data/stores.json
python3 - <<'PY'
import json,time
D="/tmp/final/data/"; now=int(time.time()*1000)
ev=json.load(open(D+"events.json"))
ev.append({"id":"e_small","title":"Tiny Tea Circle","description":"x","date":now+3*86400000,"location":"Studio","capacity":2,"waitlistCapacity":1,"type":"class","published":True,"createdAt":2})
json.dump(ev,open(D+"events.json","w"))
json.dump([{"id":"reg_old","eventId":"e_small","name":"Old","email":"old@example.com","status":"registered","manageToken":"m","createdAt":1}],open(D+"registrations.json","w"))
json.dump({"loyaltyEnabled":True,"pointsPerDollar":1,"pointsPerDollarRedeemed":100,"minPointsToRedeem":100},open(D+"settings.json","w"))
PY
node /tmp/harness/tokens.mjs > /tmp/harness/tokens.json
node /tmp/harness/mockgw.cjs > /tmp/harness/mock.log 2>&1 &
MOCK=$!
cd /tmp/final
TZ=UTC AUTH_SECRET="test-secret-at-least-32-characters-long!!" AI_GATEWAY_API_KEY=test-key AI_GATEWAY_BASE_URL=http://127.0.0.1:4555/v1 RESEND_API_KEY=re_test RESEND_BASE_URL=http://127.0.0.1:4555 INQUIRY_TO_EMAIL=team@example.com RESEND_WEBHOOK_SECRET=whsec_dGVzdHNlY3JldHRlc3RzZWNyZXQxMjM0NTY= SOURCES_TEST_ALLOW_HOST=127.0.0.1:4555 UPLOAD_TEST_TOKEN=vercel_blob_rw_teststore123_secretvalue npx next start -p 3470 > /tmp/harness/app15.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null localhost:3470/api/assistant/status && break; sleep 0.5; done
python3 /tmp/harness/hardening.py
kill $MOCK $APP 2>/dev/null; free_ports
rm -rf /tmp/final/data/transcripts /tmp/final/data/traffic-*.json /tmp/final/data/campaigns.json /tmp/final/data/reminder-*.json /tmp/final/data/assistant-sources.json /tmp/final/data/login-codes.json /tmp/final/data/admins.json /tmp/final/data/bundles.json /tmp/final/data/media-deleted.log; rm -f /tmp/final/data/settings.json /tmp/final/data/audit.jsonl /tmp/final/data/flags-development.json /tmp/final/data/flags-shared.json /tmp/final/data/email-templates.json
