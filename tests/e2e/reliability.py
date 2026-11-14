import json, urllib.request, time, threading
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json"))
ADMIN=f"gallery_admin={T['admin']}"
results=[]
def check(n,c,d=""):
    results.append(c); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {d}"))
def req(path, body=None, cookie=None, method=None, headers=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data else "GET"))
    r.add_header("content-type","application/json")
    for k,v in (headers or {}).items(): r.add_header(k,v)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def mailbox():
    with urllib.request.urlopen(GW+"/__mail") as r: return json.loads(r.read())

# ---------- events: legacy data survives, capacity + waitlist hold under a burst
regs=json.load(open(D+"registrations.json"))
check("seed: one existing registration", len(regs)==1)
out=[None]*6
def reg(i):
    out[i]=req("/api/events/register", {"eventId":"e_small","name":f"Guest {i}","email":f"g{i}@example.com"})
th=[threading.Thread(target=reg,args=(i,)) for i in range(6)]
[t.start() for t in th]; [t.join() for t in th]
ok=[r for s,r in out if s==200]
check("burst: exactly 1 registered + 1 waitlisted accepted (cap 2 incl. existing, waitlist 1)",
      sorted(r["status"] for r in ok)==["registered","waitlisted"], out)
check("burst: the rest told it's full", sum(1 for s,r in out if s==400 and "full" in r.get("error",""))==4, out)
regs=json.load(open(D+"registrations.json"))
check("burst: nothing lost, existing registration kept", len(regs)==3 and any(r["email"]=="old@example.com" for r in regs), regs)
s,r=req("/api/events/register", {"eventId":"e_small","name":"Old","email":"OLD@example.com"})
check("duplicate registration refused", s==400 and "already" in r["error"], (s,r))
s,r=req("/api/events/register", {"eventId":"nope","name":"x","email":"x@example.com"})
check("unknown event 404", s==404)
# admin cancel promotes the waitlist
old=next(x for x in regs if x["email"]=="old@example.com")
wl=next(x for x in regs if x["status"]=="waitlisted")
s,r=req("/api/admin/events", {"registrationId":old["id"],"action":"cancel"}, cookie=ADMIN, method="PATCH")
check("admin cancel promotes first on waitlist", s==200 and r["promoted"]["id"]==wl["id"] and r["cancelled"]["status"]=="cancelled", r)
s,r=req("/api/admin/events", {"registrationId":"nope","action":"cancel"}, cookie=ADMIN, method="PATCH")
check("admin cancel unknown -> 404", s==404)
s,r=req("/api/admin/events", {"registrationId":old["id"],"action":"promote"}, cookie=ADMIN, method="PATCH")
check("admin promote", s==200 and r["registration"]["status"]=="registered", r)
s,r=req("/api/admin/events?eventId=e_small", cookie=ADMIN)
check("admin sees all registrations", s==200 and len(r["registrations"])==3, r)
s,r=req("/api/events")
ev=[e for e in r.get("events",[]) if e["id"]=="e_small"]
check("public events list still works", s==200 and len(ev)==1, r)
# admin event edits still work
s,r=req("/api/admin/events", {"title":"New Class","date":int(time.time()*1000)+9e8,"location":"Sedona"}, cookie=ADMIN)
check("admin create event", s==200 and r["event"]["title"]=="New Class", r)
s,r=req("/api/admin/events", {"id":r["event"]["id"],"title":"Renamed"}, cookie=ADMIN, method="PATCH")
check("admin edit event", s==200 and r["event"]["title"]=="Renamed", r)
check("events file intact", len(json.load(open(D+"events.json")))==3)

# ---------- discounts admin still works
s,r=req("/api/admin/discounts", {"code":"SAVE10","type":"percentage","value":10}, cookie=ADMIN)
check("admin create discount", s==200 and r["discount"]["code"]=="SAVE10", r)
s,r=req("/api/admin/discounts", {"id":r["discount"]["id"],"active":False}, cookie=ADMIN, method="PATCH")
check("admin toggle discount", s==200 and r["discount"]["active"]==False, r)

# ---------- loyalty: points only on COMPLETED orders, never twice (2026-11-10)
def member(): return next(u for u in json.load(open(D+"users.json")) if u["id"]=="u_member")
def order2(): return next(o for o in json.load(open(D+"orders.json")) if o["id"]=="ord_2_zzzzzz")
before=member()["loyaltyPoints"]
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"paid"}, cookie=ADMIN, method="PATCH")
check("paid: no points yet", s==200 and member()["loyaltyPoints"]==before, (before,member()["loyaltyPoints"],r))
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"completed"}, cookie=ADMIN, method="PATCH")
after1=member()["loyaltyPoints"]
check("completed: one point per $1 of products", s==200 and after1==before+80, (before,after1,r))
# simulate a stale read: the order file loses its loyaltyPointsEarned marker
orders=json.load(open(D+"orders.json"))
for o in orders:
    if o["id"]=="ord_2_zzzzzz": o.pop("loyaltyPointsEarned",None)
json.dump(orders, open(D+"orders.json","w"))
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"completed"}, cookie=ADMIN, method="PATCH")
u=member()
check("no double award on stale order read", s==200 and u["loyaltyPoints"]==after1, (after1,u["loyaltyPoints"]))
check("points history has one earn for the order", sum(1 for h in u["pointsHistory"] if h.get("orderId")=="ord_2_zzzzzz" and h["amount"]>0)==1, u["pointsHistory"])
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"paid"}, cookie=ADMIN, method="PATCH")
check("completed -> paid: points taken back until it's completed", s==200 and member()["loyaltyPoints"]==before, member()["loyaltyPoints"])
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"completed"}, cookie=ADMIN, method="PATCH")
check("completed again: points back, once", s==200 and member()["loyaltyPoints"]==after1 and order2().get("loyaltyPointsEarned")==80, (member()["loyaltyPoints"],order2()))

# ---------- loyalty: a cancelled order keeps no points
users=json.load(open(D+"users.json"))
for x in users:
    if x["id"]=="u_member":
        x["loyaltyPoints"]=x["loyaltyPoints"]-100
        x["pointsHistory"].append({"amount":-100,"reason":"Redeemed on order ZZZZZZ","date":1,"orderId":"ord_2_zzzzzz"})
json.dump(users, open(D+"users.json","w"))
b0=member()["loyaltyPoints"]
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"cancelled"}, cookie=ADMIN, method="PATCH")
u=member()
check("cancel: earned points taken back, spent points returned", s==200 and u["loyaltyPoints"]==b0-80+100, (b0,u["loyaltyPoints"],r))
check("cancel: both changes in the points history", any(h.get("kind")=="earn_back" and h["amount"]==-80 for h in u["pointsHistory"]) and any(h.get("kind")=="redeem_back" and h["amount"]==100 for h in u["pointsHistory"]), u["pointsHistory"][-3:])
check("cancel: order stamped with the points taken back", order2().get("loyaltyPointsTakenBack")==80, order2())
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"cancelled"}, cookie=ADMIN, method="PATCH")
check("cancel twice: nothing moves again", s==200 and member()["loyaltyPoints"]==b0-80+100, member()["loyaltyPoints"])
s,r=req("/api/admin/orders", {"id":"ord_2_zzzzzz","status":"completed"}, cookie=ADMIN, method="PATCH")
u=member()
check("un-cancel to completed: points spent again and earned again", s==200 and u["loyaltyPoints"]==b0, (b0,u["loyaltyPoints"]))
check("un-cancel: order no longer marked as taken back", s==200 and not order2().get("loyaltyPointsTakenBack") and order2().get("loyaltyPointsEarned")==80, order2())

# ---------- loyalty: the customer's "I've paid" earns nothing; the Points check
orders=json.load(open(D+"orders.json"))
o3=dict(order2()); o3.update({"id":"ord_3_pppppp","status":"pending","paymentToken":"t3pts","shippingMethod":"ship","shippingCost":10,"total":50,"subtotal":50})
for k in ("loyaltyPointsEarned","loyaltyPointsTakenBack","paidAt","shippedAt","pickedUpAt","stockTaken","stockReturnedAt"): o3.pop(k,None)
o4=dict(o3); o4.update({"id":"ord_4_oldold","paymentToken":"t4pts","status":"paid","createdAt":1760000000000})  # Oct 2025: before the rule
orders += [o3, o4]
json.dump(orders, open(D+"orders.json","w"))
b1=member()["loyaltyPoints"]
s,r=req("/api/orders/mark-paid", {"token":"t3pts"})
check("customer 'I've paid': order paid, no points", s==200 and member()["loyaltyPoints"]==b1, (s,r,member()["loyaltyPoints"]))
s,r=req("/api/admin/loyalty/check", cookie=ADMIN, method="GET")
check("points check: everyone matches", s==200 and r["rows"]==[] and r["members"]>=1 and r["ok"]==r["members"], r)
check("points check: staff only", req("/api/admin/loyalty/check", cookie=None, method="GET")[0]==401)
# the old bug: points on an order that isn't completed, plus older/other points the check must leave alone
users=json.load(open(D+"users.json"))
for x in users:
    if x["id"]=="u_member":
        x["loyaltyPoints"]+=40+30+25
        x["pointsHistory"]+= [{"amount":40,"reason":"Earned on order PPPPPP","date":2,"orderId":"ord_3_pppppp"},
                              {"amount":30,"reason":"Earned on order OLDOLD","date":2,"orderId":"ord_4_oldold"},
                              {"amount":25,"reason":"Thank you","date":2}]
json.dump(users, open(D+"users.json","w"))
b2=member()["loyaltyPoints"]
s,r=req("/api/admin/loyalty/check", cookie=ADMIN, method="GET")
row=(r.get("rows") or [{}])[0]
check("points check: flags the paid-not-completed order only", s==200 and len(r["rows"])==1 and [ (w["ref"],w["has"],w["should"],w["status"]) for w in row.get("wrong",[]) ]==[("PPPPPP",40,0,"paid")], r)
s,r=req("/api/admin/loyalty/check", {}, cookie=ADMIN)
check("points check fix: takes back just that order", s==200 and r["done"]==[{"name":r["done"][0]["name"],"ref":"PPPPPP","earned":0,"takenBack":40}] and member()["loyaltyPoints"]==b2-40 and r["check"]["rows"]==[], (r, member()["loyaltyPoints"]))
s,r=req("/api/admin/orders", {"id":"ord_3_pppppp","status":"completed"}, cookie=ADMIN, method="PATCH")
check("completed with shipping: products only ($50 - $10 = 40)", s==200 and member()["loyaltyPoints"]==b2, (b2, member()["loyaltyPoints"]))
s,r=req("/api/admin/loyalty/check", cookie=ADMIN, method="GET")
check("points check: all match again", s==200 and r["rows"]==[], r)

# ---------- export: faked cron can't pick the recipient
n=len(mailbox())
s,r=req("/api/admin/export-email?email=attacker@evil.test", headers={"user-agent":"vercel-cron/1.0"})
m=mailbox()[n:]
check("faked cron: export goes only to the configured inbox", s==200 and m and all(x["to"] in ("team@example.com",["team@example.com"]) for x in m) and not any("evil" in json.dumps(x["to"]) for x in m), (s, [x["to"] for x in m]))
s,r=req("/api/admin/export-email?email=attacker@evil.test")
check("no cron, no admin -> 401", s==401, s)
n=len(mailbox())
s,r=req("/api/admin/export-email?email=me@example.com", cookie=ADMIN, method="POST")
m=mailbox()[n:]
check("admin can still choose a recipient", s==200 and m and m[-1]["to"] in ("me@example.com",["me@example.com"]), (s,[x["to"] for x in m]))

# ---------- admin emails escape customer-typed names
n=len(mailbox())
s,r=req("/api/retail/checkout", {"items":[{"productId":"p_pub","quantity":1}],"name":"<a href='https://evil.test'>Click to verify</a>","email":"x@example.com",
       "address":{"addressLine1":"1 Main","city":"Flag","state":"AZ","postalCode":"86001"}})
adm=[x for x in mailbox()[n:] if x["to"] in ("team@example.com",["team@example.com"])]
check("retail checkout still works", s==200 and r.get("ok"), (s,r))
check("admin alert escapes the name", adm and "&lt;a href=" in adm[-1]["html"] and "<a href='https://evil.test'" not in adm[-1]["html"], adm and adm[-1]["html"][:300])

print(f"\n{sum(results)}/{len(results)} passed")
