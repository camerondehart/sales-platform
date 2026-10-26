import json, urllib.request
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:500]}"))
def req(path, body=None, cookie=None, method=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data else "GET"))
    r.add_header("content-type","application/json")
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def chat(t, cookie=ADMIN, mode="admin"): return req("/api/assistant/chat", {"mode":mode,"messages":[{"role":"user","content":t}]}, cookie)[1]
def mail():
    with urllib.request.urlopen(GW+"/__mail") as r: return json.loads(r.read())
def ping(p): urllib.request.urlopen(GW+p).read()
def confirm(a): rq=a["request"]; return req(rq["url"], rq["body"], ADMIN, rq["method"])

r=chat("act:remind"); a=(r.get("actions") or [None])[0]
check("reminder: one card, nothing sent yet", a and a["kind"]=="order_message" and len(mail())==0, r)
check("reminder: card shows recipient, subject, order, pay button", a and "To: mem@example.com" in a["lines"][0] and "Subject: A gentle reminder about your order" in a["lines"] and any("$80.00" in l and "pending" in l for l in a["lines"]) and any("View & pay" in l for l in a["lines"]), a and a["lines"])
check("reminder: full email preview with greeting", a and a["preview"].startswith("Hello, Mia Member\n\nJust a friendly note") and "— The Northwind team" in a["preview"], a and a["preview"])
check("reminder: button says Send email / Sending…", a and a["confirmLabel"]=="Send email" and a["busyLabel"]=="Sending…")
check("reminder: no campaign draft", not r.get("draft"))

s,d=confirm(a); m=mail()[-1] if mail() else {}
check("send: ok and reports recipient", s==200 and d.get("sentTo")=="mem@example.com" and d.get("payLink") is True, (s,d))
check("send: to the customer, reply goes to the team", m.get("to") in ("mem@example.com",["mem@example.com"]) and m.get("reply_to") in ("team@example.com",["team@example.com"]), m)
check("send: subject as shown", m.get("subject")=="A gentle reminder about your order", m.get("subject"))
check("send: greeting, escaped text, pay button to this order", "Hello, Mia Member" in m.get("html","") and "&lt;script&gt;" in m["html"] and "<script>" not in m["html"] and "/pay/t2" in m["html"] and "$80.00" in m["html"], m.get("html","")[:800])
check("send: exactly one email", len(mail())==1)

r=chat("act:remind-paid"); a=r["actions"][0]
check("paid order: no pay button offered", not any("View & pay" in l for l in a["lines"]) and a["request"]["body"]["includePayLink"] is False, a)
s,d=confirm(a); m=mail()[-1]
check("paid order: sent to guest without a pay link", s==200 and m["to"] in ("pat@example.com",["pat@example.com"]) and "/pay/" not in m["html"], m["html"][:300])

r=chat("act:remind-dupe")
check("same order twice: only one card", len(r.get("actions") or [])==1, r)
r=chat("act:code-dupe")
check("same discount code twice in one reply: one card", len(r.get("actions") or [])==1 and "DUPE10" in r["actions"][0]["title"], r)
r=chat("act:code-dupe-auto")
check("two identical cards in one reply: shown once", len(r.get("actions") or [])==1, r)
r=chat("act:remind-bad")
check("unknown order: no card", not r.get("actions") and "No order with that id" in r["reply"], r)
r=chat("act:remind-empty")
check("empty message: no card", not r.get("actions") and "Need a subject" in r["reply"], r)

r=chat("act:member-msg"); a=r["actions"][0]
check("member message: card", a["kind"]=="member_message" and "To: mem@example.com" in a["lines"][0] and a["preview"].startswith("Hello, Mia Member"), a)
n=len(mail()); s,d=confirm(a)
check("member message: sent", s==200 and d.get("sentTo")=="mem@example.com" and len(mail())==n+1, (s,d))

# mail service rejects → honest failure, for both the assistant and the dashboard's own buttons
ping("/__mailfail")
r=chat("act:remind"); a=r["actions"][0]
s,d=confirm(a)
check("mail service down: order message reports failure", s==502 and "wasn't sent" in d.get("error",""), (s,d))
s,d=req("/api/admin/users/message", {"userId":"u_member","message":"hi"}, ADMIN)
check("mail service down: member message reports failure", s==502 and "wasn't sent" in d.get("error",""), (s,d))
ping("/__mailok")

# dashboard's own order Message button (no pay link param) unchanged
n=len(mail())
s,d=req("/api/admin/orders/message", {"orderId":"ord_2_zzzzzz","message":"Dashboard note"}, ADMIN)
m=mail()[-1]
check("dashboard order message: unchanged (no pay button unless asked)", s==200 and len(mail())==n+1 and "/pay/" not in m["html"] and "Dashboard note" in m["html"], (s,d))

# customers can't
r=chat("act:remind", cookie=None, mode="site")
check("public: refused", not r.get("actions") and "not available" in r["reply"], r)
r=chat("act:member-msg", cookie=MEMBER, mode="site")
check("member: refused", not r.get("actions") and "not available" in r["reply"], r)
s,d=req("/api/admin/orders/message", {"orderId":"ord_2_zzzzzz","message":"x","includePayLink":True}, MEMBER)
check("endpoint needs admin", s==401, s)

# campaign drafts still exist for newsletters
r=chat("draft a newsletter")
check("newsletter drafts still go to the composer", r.get("draft") and not r.get("actions"), r)
print(f"\n{sum(res)}/{len(res)} passed")
