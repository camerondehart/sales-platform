import json, urllib.request, time, os
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:500]}"))
def req(path, body=None, cookie=ADMIN, method=None, headers=None, raw=False):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json")
    for k,v in (headers or {}).items(): r.add_header(k,v)
    if cookie: r.add_header("cookie", cookie)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    op=urllib.request.build_opener(NoRedirect)
    try:
        with op.open(r, timeout=90) as resp:
            b=resp.read(); return resp.status, (b.decode() if raw else json.loads(b or b"{}")), dict(resp.headers)
    except urllib.error.HTTPError as e:
        b=e.read()
        try: return e.code, (b.decode() if raw else json.loads(b or b"{}")), dict(e.headers)
        except Exception: return e.code, {}, dict(e.headers)
def chat(t, cookie=ADMIN, mode="admin", ip="10.9.0.1"): return req("/api/assistant/chat", {"mode":mode,"messages":[{"role":"user","content":t}]}, cookie, headers={"x-forwarded-for":ip})[1]
def mail():
    with urllib.request.urlopen(GW+"/__mail") as r: return json.loads(r.read())
def audit_rows():
    try: return [json.loads(l) for l in open(D+"audit.jsonl") if l.strip()]
    except FileNotFoundError: return []
def confirm(a):
    rq=a["request"]; return req(rq["url"], rq["body"], ADMIN, rq["method"], headers={"x-fp-source":"assistant","x-fp-proposal":a["kind"]})

# ============ Feature flags
s,r,_=req("/api/admin/flags")
keys=[f["key"] for f in r.get("flags",[])]
check("flags: all 24 listed for this environment", s==200 and len(keys)==24 and r["env"]=="development", (s,r))
s,r,_=req("/api/admin/flags", cookie=MEMBER)
check("flags: admin only", s==401, s)
_s,_fl,_=req("/api/admin/flags")
_unbuilt=[f["key"] for f in _fl.get("flags",[]) if not f.get("built")]
if _unbuilt:
    s,r,_=req("/api/admin/flags", {"key":_unbuilt[0],"on":True})
    check("flags: unbuilt feature can't be switched on", s==400 and "isn't built" in r.get("error",""), (s,r))
else:
    s,r,_=req("/api/admin/flags", {"key":"not_a_real_switch","on":True})
    check("flags: unknown switch refused", s==400, (s,r))

n0=len(audit_rows())
s,r,_=req("/api/admin/flags", {"key":"ai_assistant","on":False})
check("kill switch: assistant off", s==200 and r["on"] is False, (s,r))
rep=chat("hello", cookie=None, mode="site")
check("kill switch: visitors get the offline message at once (no redeploy)", rep.get("offline") is True, rep)
rep=chat("hello")
check("kill switch: staff assistant off too", rep.get("offline") is True, rep)
s,st,_=req("/api/assistant/status", cookie=None)
check("kill switch: widget hidden (status unavailable)", st["available"]["public"] is False, st)
rows=audit_rows()[n0:]
check("kill switch: logged once with before/after", len(rows)==1 and rows[0]["action"]=="flag.set" and rows[0]["before"]=={"on":True} and rows[0]["after"]=={"on":False}, rows)
req("/api/admin/flags", {"key":"ai_assistant","on":True})
rep=chat("hello", cookie=None, mode="site", ip="10.9.0.2")
check("kill switch: back on", not rep.get("offline"), rep)
check("flags: stored per environment", os.path.exists(D+"flags-development.json"))

req("/api/admin/flags", {"key":"ai_admin_actions","on":False})
r=chat("act:sale-pct")
check("actions switch off: no confirm cards", not r.get("actions") and "switched off" in r["reply"], r)
req("/api/admin/flags", {"key":"ai_admin_actions","on":True})
r=chat("act:sale-pct")
check("actions switch on: cards again", len(r.get("actions") or [])==1, r)

# ============ Audit log: exactly one row per admin write, on every write route
cases=[
 ("PUT","/api/admin/assistant",{}),("POST","/api/admin/settings",{"partial":True}),("POST","/api/admin/password",{}),
 ("POST","/api/admin/products",{}),("DELETE","/api/admin/products",None),("PATCH","/api/admin/products",{}),("PUT","/api/admin/products",{}),
 ("DELETE","/api/admin/inquiries/delete",None),("POST","/api/admin/discounts",{}),("PATCH","/api/admin/discounts",{"id":"nope"}),("DELETE","/api/admin/discounts",None),
 ("POST","/api/admin/loyalty",{}),("POST","/api/admin/send-invoice",{}),("POST","/api/admin/users/password",{}),("POST","/api/admin/users/message",{}),
 ("PATCH","/api/admin/users/profile",{}),("POST","/api/admin/users",{}),("PATCH","/api/admin/users",{}),("DELETE","/api/admin/users",None),
 ("POST","/api/admin/users/import",{}),("POST","/api/admin/campaigns",{}),("POST","/api/admin/subscribers",{}),("DELETE","/api/admin/subscribers",None),
 ("POST","/api/admin/subscribers/import",{}),("POST","/api/admin/shipping-label",{}),("POST","/api/admin/orders/message",{}),("PATCH","/api/admin/orders",{}),
 ("POST","/api/admin/orders/shipping-label",{}),("POST","/api/admin/events",{}),("PATCH","/api/admin/events",{}),("DELETE","/api/admin/events",None),
 ("POST","/api/admin/banner",{"partial":True}),("POST","/api/admin/flags",{}),("POST","/api/admin/templates",{}),
 ("POST","/api/admin/assistant/escalations/esc_none",{}),("POST","/api/admin/orders/resend-invoice",{}),
]
bad=[]
for m,p,b in cases:
    n=len(audit_rows())
    s,_,_=req(p, b if b is not None else None, method=m) if b is not None else req(p, None, method=m)
    got=len(audit_rows())-n
    if got!=1: bad.append((m,p,s,got))
check(f"audit: every admin write route writes exactly one row ({len(cases)} routes)", not bad, bad)
n=len(audit_rows())
for m,p,b in cases[:6]:
    req(p, b, cookie=MEMBER, method=m) if b is not None else req(p, None, cookie=MEMBER, method=m)
check("audit: rejected (not signed in) requests write nothing", len(audit_rows())==n, len(audit_rows())-n)

n=len(audit_rows())
req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"paid"}, method="PATCH")
row=audit_rows()[n]
check("audit: order status change has before/after, target, staff source", row["action"]=="order.status_change" and row["before"]["status"]=="pending" and row["after"]=={"status":"paid"} and row["targetId"]=="ord_2_zzzzzz" and row["source"]=="human" and row["ok"], row)
req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"pending"}, method="PATCH")
n=len(audit_rows())
req("/api/admin/password", {"adminPassword":"SuperSecret123"})
row=audit_rows()[n]
check("audit: secrets are never logged", "SuperSecret123" not in json.dumps(row) and "[redacted]" in json.dumps(row), row)
req("/api/admin/password", {"adminPassword":"changemetoo"})
n=len(audit_rows())
req("/api/admin/discounts", {"code":"X"})  # invalid -> 400
row=audit_rows()[n]
check("audit: failed writes are logged as failed with the reason", row["ok"] is False and row["status"]>=400, row)

# job runs
n=len(audit_rows())
req("/api/admin/export-email", {}, method="POST")
req("/api/admin/export-email", cookie=None, headers={"user-agent":"vercel-cron/1.0"})
rows=audit_rows()[n:]
check("jobs: manual and scheduled report runs both logged", [r["action"] for r in rows]==["report.send_now","job.nightly_report"] and rows[1]["source"]=="system", rows)

# viewer
s,r,_=req("/api/admin/audit?limit=500")
check("viewer: newest first", s==200 and r["entries"][0]["at"]>=r["entries"][-1]["at"], s)
s,r,_=req("/api/admin/audit?failed=1")
check("viewer: failed filter", r["entries"] and all(not e["ok"] for e in r["entries"]))
s,r,_=req("/api/admin/audit", cookie=MEMBER)
check("viewer: admin only", s==401, s)

# ============ Assistant gap closure
n=len(audit_rows())
rep=chat("order ABC4K9 wrong@example.com", cookie=None, mode="site", ip="10.9.0.3")
rows=[r for r in audit_rows()[n:] if r["action"]=="assistant.access_denied"]
check("guardrail: someone else's order stays hidden and an alert is logged", '"found":false' in rep["reply"] and len(rows)==1 and rows[0]["targetId"]=="ABC4K9" and rows[0]["ip"]=="10.9.0.3", (rep, rows))

# make the unpaid order 5 days old and the pending member 2 days old
o=json.load(open(D+"orders.json"))
for x in o:
    if x["id"]=="ord_2_zzzzzz": x["createdAt"]=int(time.time()*1000)-5*86400000
json.dump(o,open(D+"orders.json","w"))
r=chat("act:daily"); body=r["reply"]
check("daily tasks: live follow-ups (unpaid order, pending member) with ids for one-click cards", "ZZZZZZ" in body and "Paula Pending" in body and "ord_2_zzzzzz" in body and "one_click" in body, body[:600])

n=len(mail())
r=chat("act:resend-inv"); a=(r.get("actions") or [None])[0]
check("resend invoice: card, nothing sent yet", a and a["kind"]=="resend_invoice" and len(mail())==n, r)
na=len(audit_rows())
s,d,_=confirm(a); m=mail()[-1]
row=audit_rows()[na]
check("resend invoice: same invoice + pay link to the customer", s==200 and d["sentTo"]=="mem@example.com" and "— copy" in m["subject"] and "/pay/t2" in m["html"], (s,d,m.get("subject")))
check("resend invoice: audit shows Concierge + approving admin", row["action"]=="invoice.resend" and row["source"]=="ai" and row["proposal"]=="resend_invoice" and row["actor"]=="admin", row)
r=chat("act:resend-inv-paid")
check("resend invoice: refused for a paid order", not r.get("actions") and "nothing to pay" in r["reply"], r)

r=chat("act:points"); a=r["actions"][0]
before=next(u for u in json.load(open(D+"users.json")) if u["id"]=="u_member")["loyaltyPoints"]
confirm(a)
after=next(u for u in json.load(open(D+"users.json")) if u["id"]=="u_member")["loyaltyPoints"]
check("points credit: two-step card, then added", a["danger"] and after==before+250, (before,after))

r=chat("act:member-email"); a=r["actions"][0]
na=len(audit_rows()); confirm(a)
u=next(u for u in json.load(open(D+"users.json")) if u["id"]=="u_member")
row=audit_rows()[na]
check("member email change: applied, audited with before/after, attributed to Concierge", u["email"]=="mia.new@example.com" and row["before"]=={"email":"mem@example.com"} and row["after"]["email"]=="mia.new@example.com" and row["source"]=="ai", (u["email"],row))
req("/api/admin/users/profile", {"id":"u_member","email":"mem@example.com"}, method="PATCH")

n=len(mail())
r=chat("act:resend-mine", cookie=MEMBER, mode="site", ip="10.9.0.4")
check("member: resend my own invoice", "Sent" in r["reply"] and len(mail())==n+1 and mail()[-1]["to"] in ("mem@example.com",["mem@example.com"]), r)
n=len(mail()); na=len(audit_rows())
r=chat("act:resend-public-bad", cookie=None, mode="site", ip="10.9.0.5")
check("visitor: wrong email → nothing sent, alert logged", len(mail())==n and any(x["action"]=="assistant.access_denied" for x in audit_rows()[na:]), r)
r=chat("act:resend-public-ok", cookie=None, mode="site", ip="10.9.0.6")
check("visitor: right ref + email → sent to the order's email only", len(mail())==n+1 and mail()[-1]["to"] in ("mem@example.com",["mem@example.com"]), r)

r=chat("act:support")
check("support report runs", "total" in r["reply"], r["reply"][:300])

s,ov,_=req("/api/admin/assistant")
check("usage now includes response time", "latencyMs" in ov["totals"] and ov["totals"]["latencyMs"]>=0, ov["totals"])

# ============ Templates
s,r,_=req("/api/admin/templates")
st=[t for t in r["templates"] if t.get("starter")]
check("templates: 9 starters incl. fall/holiday/spring/summer/promo/event/blank", s==200 and len(st)==9 and {"fall","holiday","spring","summer","promo","event","blank"} <= {t["category"] for t in st}, [t["category"] for t in st])
s,r,_=req("/api/admin/templates", {"action":"duplicate","id":"starter_fall"})
tid=r["template"]["id"]
check("templates: duplicate a starter", s==200 and r["template"]["name"]=="Fall ritual (copy)", r)
s,r,_=req("/api/admin/templates", {"action":"save","id":tid,"name":"Fall 2026","category":"fall","subject":"Hi","body":"# Hey"})
check("templates: edit saved copy", s==200 and r["template"]["name"]=="Fall 2026", r)
s,r,_=req("/api/admin/templates", {"action":"archive","id":tid})
check("templates: archive", s==200 and r["template"]["archived"] is True, r)
s,r,_=req("/api/admin/templates", {"action":"archive","id":"starter_fall"})
check("templates: starters can't be archived", s==400, r)
s,r,_=req("/api/admin/templates", {"action":"save","name":"Throwaway","category":"promo","subject":"x","body":"# Bye"})
did_t=r["template"]["id"]
s,r,_=req("/api/admin/templates", {"action":"delete","id":did_t})
s2,r2,_=req("/api/admin/templates")
check("templates: delete one of yours", s==200 and not any(t["id"]==did_t for t in r2["templates"]), (s,r))
check("templates: deleted template kept in the Activity log", any(a.get("action")=="template.delete" and (a.get("before") or {}).get("name")=="Throwaway" for a in audit_rows()))
s2,r2,_=req("/api/admin/templates", {"action":"delete","id":did_t})
check("templates: deleting twice says not found", s2==404, r2)
# built-ins: redo in place, reset, remove, bring back
s,r,_=req("/api/admin/templates", {"action":"save","id":"starter_fall","name":"Fall ritual","category":"fall","subject":"Autumn, freshly worded","body":"# New fall words"})
s2,r2,_=req("/api/admin/templates")
f=next((t for t in r2["templates"] if t["id"]=="starter_fall"), {})
check("templates: a built-in can be rewritten in place (Redo with AI)", s==200 and f.get("subject")=="Autumn, freshly worded" and f.get("edited") is True and f.get("starter") is True and sum(1 for t in r2["templates"] if t["id"]=="starter_fall")==1, f)
s,r,_=req("/api/admin/templates", {"action":"reset","id":"starter_fall"})
s2,r2,_=req("/api/admin/templates")
f=next((t for t in r2["templates"] if t["id"]=="starter_fall"), {})
check("templates: Reset puts a built-in back to its original", s==200 and f.get("subject")!="Autumn, freshly worded" and not f.get("edited"), f)
s,r,_=req("/api/admin/templates", {"action":"delete","id":"starter_fall"})
s2,r2,_=req("/api/admin/templates")
check("templates: a built-in can be removed", s==200 and not any(t["id"]=="starter_fall" for t in r2["templates"]) and r2.get("hiddenStarters")==1, (s,r,r2.get("hiddenStarters")))
s,r,_=req("/api/admin/templates", {"action":"save","id":"starter_fall","name":"x","subject":"y","body":"z"})
check("templates: a removed built-in can't be edited until it's back", s==400, r)
s,r,_=req("/api/admin/templates", {"action":"restore_starters"})
s2,r2,_=req("/api/admin/templates")
check("templates: removed built-ins come back", s==200 and r.get("restored")==1 and any(t["id"]=="starter_fall" for t in r2["templates"]) and r2.get("hiddenStarters")==0, (r, r2.get("hiddenStarters")))

# ============ Product videos + permanent QR links
p0=next(p for p in json.load(open(D+"products.json")) if p["id"]=="p_pub")
s,r,_=req("/api/admin/products", {**{k:p0[k] for k in ("id","name","description","price","image","visibility","category")}, "video":"https://youtu.be/dQw4w9WgXcQ", "bundleProducts":["a","b"]}, method="PUT")
check("video: YouTube link saved", s==200 and r["product"]["video"]=="https://youtu.be/dQw4w9WgXcQ", (s,r))
s,r,_=req("/api/admin/products", {**{k:p0[k] for k in ("id","name","description","price","image","visibility","category")}, "video":"javascript:alert(1)"}, method="PUT")
check("video: unsafe link refused", s==400 and "video link" in r.get("error",""), (s,r))
s,r,_=req("/api/admin/products", {**{k:p0[k] for k in ("id","name","description","image","visibility","category")}, "price":"$31"}, method="PUT")
check("video + bundle contents survive a normal dashboard edit", s==200 and r["product"]["video"]=="https://youtu.be/dQw4w9WgXcQ" and r["product"].get("bundleProducts")==["a","b"], r)
s,html,_=req("/retail", cookie=None, raw=True)
check("video: shoppers get it on the product", s==200 and "dQw4w9WgXcQ" in html, s)
req("/api/admin/flags", {"key":"product_videos","on":False}); time.sleep(0.2)
s,html,_=req("/retail", cookie=None, raw=True)
check("video switch off: hidden from shoppers, link kept", "dQw4w9WgXcQ" not in html and next(p for p in json.load(open(D+"products.json")) if p["id"]=="p_pub")["video"], s)
req("/api/admin/flags", {"key":"product_videos","on":True})
s,_,h=req("/p/p_pub", cookie=None, raw=True)
check("QR link: public product → shop with it open", s==307 and h.get("location","").endswith("/retail?product=p_pub"), (s,h.get("location")))
s,_,h=req("/p/p_mem", cookie=None, raw=True)
check("QR link: members-only product → members page", s==307 and h.get("location","").endswith("/gallery?product=p_mem"), (s,h.get("location")))
s,_,h=req("/p/p_deleted", cookie=None, raw=True)
check("QR link: removed product still lands on the shop (never a dead code)", s==307 and h.get("location","").endswith("/retail"), (s,h.get("location")))

# ============ Terms
s,html,_=req("/terms", cookie=None, raw=True)
check("terms page live", s==200 and "Terms of Service" in html, s)
s,html,_=req("/join?event=Farmers%20Market", cookie=None, raw=True)
check("event QR page: sign-up form, then the public shop below with the scroll cue", s==200 and "Join the mailing list" in html and "Farmers Market" in html and 'id="shop"' in html and "Shop our range below" in html and "Harmony Blend Extract" in html, s)
# ---------- event offers: an event's sign-ups get its discount code in the welcome email
s,r,_=req("/api/admin/discounts", {"code":"FARMERS15","type":"percentage","value":15,"perCustomerLimit":1})
did=r["discount"]["id"]
s,r,_=req("/api/admin/discounts", {"code":"OLDCODE","type":"fixed","value":5,"active":False})
oid=r["discount"]["id"]
s,r,_=req("/api/admin/event-offers", {"event":"Farmers Market","discountId":did}, cookie=None, method="PUT")
check("event offer: staff only", s==401, s)
s,r,_=req("/api/admin/event-offers", {"event":"Farmers Market","discountId":oid}, method="PUT")
check("event offer: a switched-off code can't be picked", s==400 and "OLDCODE" in r.get("error",""), (s,r))
s,r,_=req("/api/admin/event-offers", {"event":"","discountId":did}, method="PUT")
check("event offer: needs an event name", s==400, (s,r))
s,r,_=req("/api/admin/event-offers", {"event":"Farmers  Market","discountId":did}, method="PUT")
check("event offer: saved", s==200 and any(o["code"]=="FARMERS15" and o["live"] and o["text"]=="15% off" for o in r["offers"]), (s,r))
check("event offer: recorded in the Activity log", any(a.get("action")=="event_offer.set" for a in audit_rows()))
s,html,_=req("/join?event=farmers%20market", cookie=None, raw=True)
check("event offer: the event page teases it (not the code)", s==200 and "15% off" in html and "FARMERS15" not in html, s)
s,html,_=req("/join?event=Craft%20Fair", cookie=None, raw=True)
check("event offer: other events show no offer", "join-offer" not in html, "")
n=len(mail())
s,r,_=req("/api/subscribe", {"name":"Fern Fair","email":"fern.offer@example.com","event":"Farmers Market"}, cookie=None)
m=[x for x in mail()[n:] if "fern.offer@example.com" in json.dumps(x.get("to"))]
check("welcome email replies go to support@", m and m[0].get("reply_to") in ("support@example.com",["support@example.com"]), m[0].get("reply_to") if m else None)
check("event offer: new sign-up's welcome email carries the code", s==200 and m and "FARMERS15" in m[0]["html"] and "15% off" in m[0]["subject"] and "One use per person" in m[0]["html"], (s, m[:1]))
n=len(mail())
req("/api/subscribe", {"name":"Fern Fair","email":"fern.offer@example.com","event":"Farmers Market"}, cookie=None)
check("event offer: signing up again doesn't send it twice", not [x for x in mail()[n:] if "fern.offer@example.com" in json.dumps(x.get("to"))])
n=len(mail())
req("/api/subscribe", {"name":"Ivy Other","email":"ivy.offer@example.com","event":"Craft Fair"}, cookie=None)
m=[x for x in mail()[n:] if "ivy.offer@example.com" in json.dumps(x.get("to"))]
check("event offer: a different event's welcome has no code", m and "FARMERS15" not in m[0]["html"], m[:1])
req("/api/admin/discounts", {"id":did,"active":False}, method="PATCH")
n=len(mail())
req("/api/subscribe", {"name":"Moss Late","email":"moss.offer@example.com","event":"Farmers Market"}, cookie=None)
m=[x for x in mail()[n:] if "moss.offer@example.com" in json.dumps(x.get("to"))]
s,html,_=req("/join?event=Farmers%20Market", cookie=None, raw=True)
check("event offer: once the code is switched off, no code is emailed or teased", m and "FARMERS15" not in m[0]["html"] and "join-offer" not in html, m[:1])
s,r,_=req("/api/admin/event-offers", {"event":"Farmers Market","discountId":None}, method="PUT")
check("event offer: can be removed", s==200 and not r["offers"], r)
# ---------- template / draft HTML preview (Templates area + Concierge cards)
s,r,_=req("/api/admin/templates/preview", {"subject":"Hi","body":"# Fall restock\n\nFresh batches.\n\n[Shop now](https://www.example.com/retail)"}, cookie=None)
check("email preview: staff only", s==401, s)
s,r,_=req("/api/admin/templates/preview", {"subject":"Fall is here","body":"# Fall restock\n\nFresh batches.\n\n[Shop now](https://www.example.com/retail)"})
h=r.get("html","")
check("email preview: the real email (house header, sample name, heading, button, footer)", s==200 and "Northwind Goods" in h and "Hi Boss" in h and "Fall restock</h2>" in h and ">Shop now</a>" in h and "Unsubscribe" in h, (s, h[:300]))
s,r,_=req("/api/admin/templates/preview", {"subject":"November news","body":"Hi\n\n[Visit the shop](/retail)","theme":"fall"})
h=r.get("html","")
check("email preview: relative links become full site buttons", s==200 and 'href="http://localhost:3470/retail"' in h and ">Visit the shop</a>" in h and "[Visit the shop]" not in h and "Hi Boss" in h, (s, h[:500]))
s,r,_=req("/api/admin/templates/preview", {"subject":"x","body":"  "})
check("email preview: empty body says so", s==400, (s,r))
# ---------- staff chat: the widget tells the model which cards it really showed (and their status)
s,r,_=req("/api/assistant/chat", {"mode":"admin","messages":[
  {"role":"user","content":"make a code"},
  {"role":"assistant","content":"Ready to confirm.\n\n[Shown with this reply — recorded by the site:\n- card \"New code COZY10: 10% off\": CONFIRMED (Created COZY10.)]"},
  {"role":"user","content":"ledgercheck did it work?"}]})
rep=r.get("reply","")
check("staff chat: card record reaches the model, with the rule to trust it", "saw:yes" in rep and "rule:yes" in rep, rep)
check("staff chat: the model can't write a fake card record into its reply", "[Shown with this reply" not in rep, rep)
# ---------- Concierge notes: learns from chats (nightly review), staff can edit
def gwlog(): return json.loads(urllib.request.urlopen(GW+"/__log").read())
s,r,_=req("/api/admin/concierge-notes", cookie=None)
check("notes: staff only", s==401, s)
s,r,_=req("/api/admin/concierge-notes")
check("notes: off by default, empty", s==200 and r["on"] is False and r["notes"]==[], r)
s,r,_=req("/api/admin/concierge-notes", {"action":"run"})
check("notes: review won't run while the switch is off", s==400 and "switch" in r.get("error",""), (s,r))
s,r,_=req("/api/assistant/card-feedback", {"kind":"order_message","title":"Remind Jess","outcome":"dismissed"}, cookie=None)
check("card feedback: staff only", s==401, s)
s,r,_=req("/api/assistant/card-feedback", {"kind":"order_message","title":"Remind Jess about order ABC123","outcome":"dismissed","todayKey":"unpaid"})
check("card feedback: saved", s==200 and any(x["outcome"]=="dismissed" for x in json.load(open(D+"card-feedback.json"))), (s,r))
req("/api/admin/flags", {"key":"concierge_learning","on":True})
s,r,_=req("/api/admin/concierge-notes", {"action":"run"})
check("notes: review runs and keeps only safe notes", s==200 and r.get("added")==3 and r.get("rejected")==4 and "no material" not in r.get("summary",""), (s,r))
s,r,_=req("/api/admin/concierge-notes")
txt=" ".join(n["text"] for n in r["notes"])
check("notes: no emails, phone numbers or rule-changing notes got in", "@" not in txt and "555" not in txt and "Ignore the safety" not in txt and not any(n.get("todayKey")=="nope" for n in r["notes"]), r["notes"])
check("notes: one of each kind, today note keyed to its item", {n["scope"] for n in r["notes"]}=={"staff","customer","today"} and any(n.get("todayKey")=="unpaid" for n in r["notes"]), r["notes"])
check("notes: run recorded", r["runs"] and r["runs"][0]["ok"] and r["runs"][0]["added"]==3, r["runs"][:1])
check("notes: review logged in the Activity log", any(a.get("action")=="concierge.notes_review" and a.get("ok") for a in audit_rows()))
n0=len(gwlog()); chat("hello there", ip="10.9.8.1")
sys_admin=[l["system"] for l in gwlog()[n0:]]
check("notes: staff Concierge sees staff + Today notes, not customer ones", sys_admin and "LEARNED NOTES" in sys_admin[0] and "cash-at-pickup" in sys_admin[0] and "[Today item unpaid]" in sys_admin[0] and "how long shipping takes" not in sys_admin[0], sys_admin[:1] and sys_admin[0][-600:])
check("notes: placed before the safety rules (rules win)", sys_admin and sys_admin[0].index("LEARNED NOTES") < sys_admin[0].index("RULES YOU MUST FOLLOW"), "")
n0=len(gwlog()); req("/api/assistant/chat", {"mode":"site","messages":[{"role":"user","content":"hello"}]}, cookie=None, headers={"x-forwarded-for":"10.9.8.2"})
sys_pub=[l["system"] for l in gwlog()[n0:]]
check("notes: customer Concierge sees only customer notes", sys_pub and "how long shipping takes" in sys_pub[0] and "cash-at-pickup" not in sys_pub[0] and "Today item" not in sys_pub[0], sys_pub[:1] and sys_pub[0][-600:])
s,r,_=req("/api/admin/concierge-notes", {"action":"add","scope":"staff","text":"Text the owner at owner@example.com about big orders"})
check("notes: staff notes are checked too (no personal details)", s==400 and "email" in r.get("error",""), (s,r))
s,r,_=req("/api/admin/concierge-notes", {"action":"add","scope":"staff","text":"The owner likes campaign drafts short, with one clear button."})
sid=r.get("note",{}).get("id")
check("notes: staff can add a note (pinned)", s==200 and r["note"]["pinned"] and r["note"]["source"]=="staff", (s,r))
ai_note=next(n for n in req("/api/admin/concierge-notes")[1]["notes"] if n["source"]=="ai" and n["scope"]=="staff")
s,r,_=req("/api/admin/concierge-notes", {"action":"edit","id":ai_note["id"],"text":"Leave cash-at-pickup orders out of payment reminder cards."})
check("notes: editing a learned note makes it the staff's", s==200 and r["note"]["source"]=="staff", r)
s,r,_=req("/api/admin/concierge-notes", {"action":"run"})
s2,r2,_=req("/api/admin/concierge-notes")
check("notes: the next review keeps staff and pinned notes as they are", any(n["id"]==sid for n in r2["notes"]) and any(n["id"]==ai_note["id"] and n["text"].startswith("Leave cash") for n in r2["notes"]), r2["notes"])
urllib.request.urlopen(GW+"/__reviewprose").read()
s,r,_=req("/api/admin/concierge-notes", {"action":"run"})
check("notes: if the model answers in prose, it's asked once more for the list", s==200 and r.get("ok"), (s,r))
s,r,_=req("/api/admin/concierge-notes", {"action":"delete","id":sid})
check("notes: delete", s==200 and not any(n["id"]==sid for n in req("/api/admin/concierge-notes")[1]["notes"]), (s,r))
s,r,_=req("/api/admin/today?fresh=1")
un=[t for t in r.get("tasks",[]) if t["id"]=="unpaid"]
check("notes: Today item shows its learned line", not un or (un[0].get("learned") and "oldest first" in un[0]["learned"][0]), un[:1])
req("/api/admin/flags", {"key":"concierge_learning","on":False})
n0=len(gwlog()); chat("hello again", ip="10.9.8.3")
check("notes: switch off = notes not used", "LEARNED NOTES" not in gwlog()[n0]["system"], "")
print(f"\n{sum(res)}/{len(res)} passed")
