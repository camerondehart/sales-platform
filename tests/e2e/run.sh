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
node /tmp/harness/tokens.mjs > /tmp/harness/tokens.json
node /tmp/harness/mockgw.cjs > /tmp/harness/mock.log 2>&1 &
MOCK=$!
cd /tmp/final
TZ=UTC AUTH_SECRET="test-secret-at-least-32-characters-long!!" AI_GATEWAY_API_KEY=test-key AI_GATEWAY_BASE_URL=http://127.0.0.1:4555/v1 RESEND_API_KEY=re_test RESEND_BASE_URL=http://127.0.0.1:4555 INQUIRY_TO_EMAIL=team@example.com npx next start -p 3470 > /tmp/harness/app.log 2>&1 &
APP=$!
for i in $(seq 1 40); do curl -s -o /dev/null localhost:3470/api/assistant/status && break; sleep 0.5; done
python3 /tmp/harness/test.py
kill $MOCK $APP 2>/dev/null; free_ports
