# Launch hardening: Resend rejections, Shippo double-label guard, form rate
# limits, payment token out of the export, safe storage switch, model privacy.
import json, urllib.request, threading, base64, os, glob, time
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json"))
ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
results=[]
def check(n,c,d=""):
    c=bool(c); results.append(c); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {d}"))
def req(path, body=None, cookie=ADMIN, method=None, ip=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data else "GET"))
    r.add_header("content-type","application/json")
    if ip: r.add_header("x-forwarded-for", ip)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def gw(p): return urllib.request.urlopen(GW+p).read()
def mailbox(): return json.loads(gw("/__mail"))
ADDR={"addressLine1":"1 Main","city":"Portland","state":"OR","postalCode":"97201"}

# ---------- Overview "Today" bulletin (stand-in site manager) — runs first, before caches warm up
import time as _t
NOW=int(_t.time()*1000); DAYMS=86400000
o=json.load(open(D+"orders.json"))
o.append({"id":"ord_old_stale1","userId":"u_member","userName":"Mia Member","userEmail":"mem@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":24.99,"total":24.99,"isInquiry":False,"status":"pending","paymentToken":"tz1","createdAt":NOW-40*DAYMS,"source":"member"})
for i in range(3):
    o.append({"id":f"ord_over_{i}","userId":"retail","userName":f"Over {i}","userEmail":f"over{i}@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"ship","shippingCost":10,"subtotal":24.99,"total":34.99,"isInquiry":False,"status":"pending","paymentToken":f"tz{i+2}","createdAt":NOW-5*DAYMS,"source":"retail"})
# Already chased: ord_over_1 by a staff message yesterday (Activity log), ord_over_2 by an automatic reminder
o[-1]["reminders"]=[{"stage":0,"at":NOW-1*DAYMS,"ok":True}]
with open(D+"audit.jsonl","a") as f: f.write(json.dumps({"id":"chase1","at":NOW-1*DAYMS,"action":"order.email_sent","actor":"admin","actorType":"admin","source":"ai","targetType":"order","targetId":"ord_over_1","ok":True})+"\n")
# An expired order (reminders gave up): never chased again, offered for close-out instead
o.append({**{k:v for k,v in o[-1].items() if k!="reminders"}, "id":"ord_expired_x", "userName":"Ex Pired", "userEmail":"expired@example.com", "createdAt":NOW-25*DAYMS, "expiredAt":NOW-4*DAYMS})
json.dump(o, open(D+"orders.json","w"))
u=json.load(open(D+"users.json"))
for i in range(3):
    u.append({"id":f"u_lapsed{i}","email":f"lapsed{i}@example.com","name":f"Lapsed {i}","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":NOW-300*DAYMS,"approvedAt":NOW-299*DAYMS})
    o.append({"id":f"ord_lapsed_{i}","userId":f"u_lapsed{i}","userName":f"Lapsed {i}","userEmail":f"lapsed{i}@example.com","items":[{"productId":"p_mem","productName":"Secret Member Tincture","price":"$40","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":40,"total":40,"isInquiry":False,"status":"completed","paymentToken":f"tl{i}","createdAt":NOW-120*DAYMS,"paidAt":NOW-120*DAYMS,"source":"member"})
# marketing: bought-together pairs, regulars due for a refill (also repeat shop customers), subscribers who never bought
def mk(i,email,name,items,days): return {"id":f"ord_mk_{i}","userId":"retail","userName":name,"userEmail":email,"items":items,"shippingMethod":"pickup","shippingCost":0,"subtotal":50,"total":50,"isInquiry":False,"status":"completed","paymentToken":f"tm{i}","createdAt":NOW-days*DAYMS,"paidAt":NOW-days*DAYMS,"source":"retail"}
PUB={"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}; MEM={"productId":"p_mem","productName":"Secret Member Tincture","price":"$40","quantity":1}
for i in range(3): o.append(mk(i,f"pair{i}@example.com",f"Pair {i}",[PUB,MEM],10))
for j,who in enumerate(["Rita Refill","Rob Refill"]):
    e=f"refill{j}@example.com"; o.append(mk(10+j*2,e,who,[PUB],70)); o.append(mk(11+j*2,e,who,[PUB],40))
json.dump([{"id":f"sub{i}","email":f"sub{i}@example.com","source":"signup","unsubscribeToken":f"u{i}","subscribedAt":NOW-30*DAYMS} for i in range(12)], open(D+"subscribers.json","w"))
for i in range(3):
    u.append({"id":f"u_new{i}","email":f"new{i}@example.com","name":f"Newbie {i}","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":NOW-11*DAYMS,"approvedAt":NOW-10*DAYMS})
json.dump(u, open(D+"users.json","w")); json.dump(o, open(D+"orders.json","w"))
pr=json.load(open(D+"products.json"))
pr.append({"id":"p_slow","name":"Dusty Tonic","description":"x","price":"$30","image":"x","category":"Tonics","visibility":"both","createdAt":NOW-200*DAYMS})
json.dump(pr, open(D+"products.json","w"))
json.dump([{"id":"disc_old","code":"SUMMEROLD","type":"percentage","value":10,"active":True,"uses":2,"usedBy":[],"createdAt":NOW-90*DAYMS,"expiresAt":NOW-3*DAYMS}], open(D+"discounts.json","w"))
s_,r_=req("/api/admin/today", cookie=None)
check("today: staff only", s_==401, s_)
s_,T_=req("/api/admin/today?fresh=1")
tasks=T_.get("tasks",[]); names=" | ".join(t["task"] for t in tasks)
check("today: loads with the Concierge ready", s_==200 and T_.get("conciergeReady") is True and len(tasks)>=6, (s_, T_))
def find(word): return next((t for t in tasks if word in t["task"]), None)
check("today: daily to-do included (chase unpaid)", find("Chase") and find("Chase")["ask"] and find("Chase")["priority"] in ("now","today"), names)
_ch=" ".join(find("Chase")["items"]) if find("Chase") else ""
check("today: orders chased in the last 3 days aren't asked for again", find("Chase") and find("Chase")["task"].startswith("Chase 2 ") and "Over 0" in _ch and "Over 1" not in _ch and "Over 2" not in _ch and "2 more already chased" in _ch, find("Chase"))
check("today: suggests closing out 30-day-old unpaid orders", find("older than 30 days") and "cancel" in find("older than 30 days")["ask"], names)
check("today: expired orders aren't chased again", "Ex Pired" not in _ch, _ch)
check("today: expired orders are offered for close-out (cancel), not reminders", find("older than 30 days") and any("Ex Pired" in i and "expired" in i for i in find("older than 30 days")["items"]), find("older than 30 days"))
check("today: suggests switching reminders on (3+ overdue, switch off)", find("automatic payment reminders") is not None, names)
check("today: suggests tidying the expired code", find("finished discount code") and "SUMMEROLD" in " ".join(find("finished discount code")["items"]), names)
check("today: win-back for quiet members", find("Win back 3 members") is not None, names)
check("today: slow seller spotted", find("haven't sold in 60 days") and any("Dusty Tonic" in i for i in find("haven't sold in 60 days")["items"]), names)
check("today: products already on sale aren't called slow", not any("Harmony Blend" in i for i in find("haven't sold in 60 days")["items"]), find("haven't sold in 60 days"))
RK={"now":0,"today":1,"this week":2,"campaign":3,"idea":4}
check("today: ordered now → today → this week → campaigns → ideas", [RK[t["priority"]] for t in tasks]==sorted(RK[t["priority"]] for t in tasks), [t["priority"] for t in tasks])
camp=[t for t in tasks if t["priority"]=="campaign"]
check("campaigns: always a calendar moment to plan, with a template and a code", any(t["task"].startswith("Plan a") and "template" in t["ask"] and "code" in t["ask"] for t in camp), [t["task"] for t in camp])
check("campaigns: at most 5 ideas at a time", 1<=len(camp)<=5, len(camp))
check("campaigns: regulars due for a refill spotted (customer rhythm)", find("due for a refill") and any("Rita Refill" in i for i in find("due for a refill")["items"]), [t["task"] for t in camp])
check("campaigns: bought-together pair → bundle idea", find("together") and "bundle" in find("together")["ask"], [t["task"] for t in camp])
check("campaigns: repeat shop customers → invite to join", find("Invite 2 repeat shop customers") is not None or find("never ordered") is not None, [t["task"] for t in camp])
check("campaigns: never emailed the list → first email suggested", find("Send your first email to 12 subscribers") is not None or len(camp)==5, [t["task"] for t in camp])
check("today: no internal ids shown, every Concierge question fits the chat box", all("{id:" not in i for t in tasks for i in t["items"]) and all(len(t.get("ask") or "")<300 for t in tasks), [len(t.get("ask") or "") for t in tasks])
check("today: every item has a button and somewhere to go", all(t["button"] and t["tab"] for t in tasks), tasks)
# The Concierge gets the exact records behind each item (today_item), so the buttons are fully doable.
def _tool(name,args):
    _s,_r=req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":"TOOL:"+json.dumps({"name":name,"args":args})}]})
    return json.loads(_r["reply"].split("TOOLRESULT::",1)[1])
_ideas=[t for t in tasks if t.get("ask") and not t["id"].split(":")[0] in ("members","unpaid","fulfil")]
check("today: every suggestion's question names its item for the Concierge", _ideas and all(t["ask"].startswith("Today item ") for t in _ideas), [t["ask"][:40] for t in _ideas])
_ti=_tool("today_item",{"key":"refill"})
check("today_item: refill gives the exact people (latest order for shop customers) and how to write", _ti.get("targets") and all(x["kind"] in ("order","member") and x["id"] for x in _ti["targets"]) and "propose_order_message" in _ti.get("how",""), _ti)
_o=json.load(open(D+"orders.json")); _oid={x["id"] for x in _o}
check("today_item: targets are real orders", all(x["id"] in _oid for x in _ti["targets"] if x["kind"]=="order"), _ti["targets"])
_ti=_tool("today_item",{"key":"stale-unpaid"})
check("today_item: stale unpaid orders listed with ids", _ti.get("targets") and _ti["targets"][0]["id"]=="ord_old_stale1" and "cancelled" in _ti["how"], _ti)
_ti=_tool("today_item",{"key":"lapsed"})
check("today_item: win-back uses the lapsed_members group (no emails needed)", "segment lapsed_members" in _ti.get("how",""), _ti)
_ti=_tool("today_item",{"key":"slow-products"})
check("today_item: slow sellers come with product ids for the sale card", _ti.get("targets") and any(x["id"]=="p_slow" for x in _ti["targets"]), _ti)
_ti=_tool("today_item",{"key":"invite-members"})
check("today_item: invitations go to each repeat shop customer personally", _ti.get("targets") and "/join" in _ti.get("how",""), _ti)
_fo=find("new members")
check("first-order: all new members in one group draft (not a handful of notes)", _fo and "new_members_no_order" in _fo["ask"] and "all 3" in _fo["ask"], _fo)
_ti=_tool("today_item",{"key":"first-order"})
check("today_item: first-order = one draft to the new_members_no_order group + a welcome code", "segment new_members_no_order" in _ti.get("how","") and "propose_discount_code" in _ti["how"] and not _ti.get("targets"), _ti)
_g=_tool("find_customer_group",{"segment":"new_members_no_order"})
check("group new_members_no_order: everyone approved 1–6 weeks ago with no order", _g.get("people_in_group")==3 and _g.get("will_receive")==3, _g)
urllib.request.urlopen(GW+"/__reset")
req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":_fo["ask"]}]})
_lg=json.loads(urllib.request.urlopen(GW+"/__log").read())
check("pressing a Today button hands the item straight to the Concierge (no lookup step needed)", _lg and "TODAY ITEM first-order" in _lg[0]["system"] and "new_members_no_order" in _lg[0]["system"], _lg[0]["system"][-400:] if _lg else _lg)
_ti=_tool("today_item",{"key":"nope"})
check("today_item: unknown item handled gracefully", "error" in _ti, _ti)
req("/api/admin/flags", {"key":"ai_admin_actions","on":False})
s_,T2=req("/api/admin/today?fresh=1")
check("today: Concierge actions off → buttons open tabs instead", s_==200 and T2.get("conciergeReady") is False and all(not t.get("ask") for t in T2["tasks"]), T2)
req("/api/admin/flags", {"key":"ai_admin_actions","on":True})
json.dump([], open(D+"discounts.json","w")); json.dump([], open(D+"subscribers.json","w"))

# ---------- Resend rejection at checkout
gw("/__mailfail")
s,r=req("/api/retail/checkout", {"items":[{"productId":"p_pub","quantity":1}],"name":"Pat Fail","email":"patfail@example.com","address":ADDR}, cookie=None, ip="7.7.7.1")
check("retail: order still placed when the invoice email is rejected", s==200 and r.get("orderId"), (s,r))
check("retail: reports emailed:false so the page doesn't promise an email", r.get("emailed") is False, r)
s,r=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup","paymentMethod":"invoice"}, cookie=MEMBER, ip="7.7.7.2")
check("members: order placed, emailed:false when Resend rejects", s==200 and r.get("emailed") is False, (s,r))
gw("/__mailok")
n0=len(mailbox())
s,r=req("/api/retail/checkout", {"items":[{"productId":"p_pub","quantity":1}],"name":"Pat Ok","email":"patok@example.com","address":ADDR}, cookie=None, ip="7.7.7.3")
check("retail: emailed:true when the invoice goes", s==200 and r.get("emailed") is True, (s,r))
new=mailbox()[n0:]
check("customer invoice replies go to support@ (Reply-To)", any(m.get("to")=="patok@example.com" and m.get("reply_to")=="support@example.com" for m in new), [(m.get("to"),m.get("reply_to")) for m in new])
check("staff alert still replies to the customer", any("Retail order from Pat Ok" in m["subject"] and m.get("reply_to")=="patok@example.com" for m in new), [(m.get("subject"),m.get("reply_to")) for m in new])
check("retail: normal admin alert has no warning", any("Retail order from Pat Ok" in m["subject"] and "NOT sent" not in m["subject"] for m in new), [m["subject"] for m in new])
s,r=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup","paymentMethod":"invoice"}, cookie=MEMBER, ip="7.7.7.4")
check("members: emailed:true when the invoice goes", s==200 and r.get("emailed") is True, (s,r))

# ---------- Shippo: never a second label by accident
orders=json.load(open(D+"orders.json"))
for o in orders:
    if o["id"]=="ord_1_abc4k9": o["labelUrl"]="https://shippo.test/label.pdf"; o["trackingNumber"]="9400TEST"
json.dump(orders, open(D+"orders.json","w"))
s,r=req("/api/admin/orders/shipping-label", {"orderId":"ord_1_abc4k9"})
check("label: second label refused without force (409 + existing label link)", s==409 and r.get("alreadyHasLabel") and r.get("labelUrl")=="https://shippo.test/label.pdf" and "9400TEST" in r.get("error",""), (s,r))
s,r=req("/api/admin/orders/shipping-label", {"orderId":"ord_1_abc4k9","force":True})
check("label: force:true goes past the guard (fails later only for the missing Shippo key)", s!=409, (s,r))
s,r=req("/api/admin/orders/shipping-label", {"orderId":"ord_1_abc4k9"}, cookie=None)
check("label: admin only", s==401, s)

# ---------- Rate limits on public forms (per IP)
codes=[req("/api/forgot-password", {"email":f"nobody{i}@example.com"}, cookie=None, ip="8.8.8.8")[0] for i in range(7)]
check("forgot-password: 6 tries allowed, the 7th gets 429", codes[:6]==[200]*6 and codes[6]==429, codes)
s,r=req("/api/forgot-password", {"email":"other@example.com"}, cookie=None, ip="8.8.4.4")
check("forgot-password: a different visitor isn't affected", s==200, (s,r))
s,r=req("/api/forgot-password", {"email":"x@example.com"}, cookie=None, ip="8.8.8.8")
check("429 has a friendly message", s==429 and "wait a few minutes" in r.get("error",""), (s,r))
codes=[req("/api/inquiry", {"name":"Spam","email":"spam@example.com","message":"hi"}, cookie=None, ip="6.6.6.6")[0] for i in range(9)]
check("inquiry: capped at 8 per 10 min per visitor", codes[8]==429 and 429 not in codes[:8], codes)

# ---------- Export: payment token column gone
gw("/__reset"); n0=len(mailbox())
r=urllib.request.Request(BASE+"/api/admin/export-email", data=b"{}", method="POST"); r.add_header("content-type","application/json"); r.add_header("cookie",ADMIN)
try: urllib.request.urlopen(r, timeout=60).read()
except urllib.error.HTTPError: pass
rep=[m for m in mailbox()[n0:] if m.get("attachments")]
oc=[a for m in rep for a in m["attachments"] if a["filename"].startswith("orders-")]
csv=base64.b64decode(oc[0]["content"]).decode() if oc else ""
check("orders spreadsheet: no Payment Token column, no tokens", csv and "Payment Token" not in csv.splitlines()[0] and ",t2," not in csv and "Tracking" in csv.splitlines()[0], csv.splitlines()[:1])

# ---------- Safe storage switch (shared by stage + live)
s,r=req("/api/admin/flags")
vf=[f for f in r.get("flags",[]) if f["key"]=="versioned_catalog"]
check("switch listed, off by default, marked shared", vf and vf[0]["on"] is False and vf[0].get("shared") is True, vf)
s,r=req("/api/admin/flags", {"key":"versioned_catalog","on":True})
check("switch on", s==200 and r.get("on") is True, (s,r))
check("shared switch stored once, not per environment", os.path.exists(D+"flags-shared.json") and any(x["id"]=="versioned_catalog" and x["on"] for x in json.load(open(D+"flags-shared.json"))))
before=len(json.load(open(D+"products.json")))
out=[None]*8
def add(i): out[i]=req("/api/admin/products", {"name":f"Race {i}","description":"x","price":"$1","image":"x","visibility":"internal"})
th=[threading.Thread(target=add,args=(i,)) for i in range(8)]; [t.start() for t in th]; [t.join() for t in th]
prods=json.load(open(D+"products.json"))
check("8 products added at once: all 8 kept", all(s==200 for s,_ in out) and len(prods)==before+8 and len({p["name"] for p in prods if p["name"].startswith("Race ")})==8, (out, len(prods)))
ids=[p["id"] for p in prods if p["name"].startswith("Race ")]
out=[None]*4
def rm(i): out[i]=req(f"/api/admin/products?id={ids[i]}", method="DELETE")
th=[threading.Thread(target=rm,args=(i,)) for i in range(4)]; [t.start() for t in th]; [t.join() for t in th]
prods=json.load(open(D+"products.json"))
check("4 deletes at once: exactly those 4 gone", len(prods)==before+4 and not set(ids[:4])&{p["id"] for p in prods}, len(prods))
out=[None]*6
def dc(i): out[i]=req("/api/admin/discounts", {"code":f"RACE{i}","type":"percentage","value":10})
th=[threading.Thread(target=dc,args=(i,)) for i in range(6)]; [t.start() for t in th]; [t.join() for t in th]
codes=[d["code"] for d in json.load(open(D+"discounts.json"))]
check("6 codes created at once: all 6 kept", all(s==200 for s,_ in out) and all(f"RACE{i}" in codes for i in range(6)), (out, codes))
out=[None]*3
def dup(i): out[i]=req("/api/admin/discounts", {"code":"SAMECODE","type":"percentage","value":10})
th=[threading.Thread(target=dup,args=(i,)) for i in range(3)]; [t.start() for t in th]; [t.join() for t in th]
check("same code created 3x at once: exactly one wins", sorted(s for s,_ in out)==[200,400,400] and [d["code"] for d in json.load(open(D+"discounts.json"))].count("SAMECODE")==1, out)
d0=[d for d in json.load(open(D+"discounts.json")) if d["code"]=="RACE0"][0]
s,r=req("/api/admin/discounts", {"id":d0["id"],"active":False}, method="PATCH")
check("turn a code off", s==200 and r["discount"]["active"] is False, (s,r))
out=[None]*3
def use(i): out[i]=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup","paymentMethod":"invoice","discountCode":"RACE1"}, cookie=MEMBER, ip=f"5.5.5.{i}")
th=[threading.Thread(target=use,args=(i,)) for i in range(3)]; [t.start() for t in th]; [t.join() for t in th]
d1=[d for d in json.load(open(D+"discounts.json")) if d["code"]=="RACE1"][0]
check("3 checkouts with the same code at once: all 3 uses counted", all(s==200 for s,_ in out) and d1["uses"]==3 and len(d1["usedBy"])==3, (out, d1["uses"]))
s,r=req("/api/admin/products", {"ids":[ids[4]],"visibility":"both"}, method="PATCH")
s2,r2=req("/api/admin/products")
check("product edit works with the switch on", any(p["id"]==ids[4] and p.get("visibility")=="both" for p in r2.get("products",[])), (s,r))
s,r=req("/api/admin/flags", {"key":"versioned_catalog","on":False})
s2,r2=req("/api/admin/products")
check("switch off: catalog unchanged and still readable", s==200 and len(r2.get("products",[]))==before+4, (s,r,len(r2.get("products",[]))))
s,r=req("/api/admin/discounts", {"code":"AFTEROFF","type":"fixed","value":5})
check("switch off: codes still save the old way", s==200 and "AFTEROFF" in [d["code"] for d in json.load(open(D+"discounts.json"))], (s,r))

# ---------- Models: privacy fields reach the picker
s,r=req("/api/admin/assistant/models")
m=(r.get("models") or [{}])[0]
check("models list carries released / noTraining / zdr", s==200 and all(k in m for k in ("released","noTraining","zdr")), m)

# ---------- Shipping weights → label weight
s_,r_=req("/api/admin/products", {"weights":{"p_pub":4.5,"p_mem":0}}, method="PATCH")
_pp={p["id"]:p for p in json.load(open(D+"products.json"))}
check("weights: saved in one go (and 0 clears)", s_==200 and _pp["p_pub"].get("weightOz")==4.5 and not _pp["p_mem"].get("weightOz"), (s_,r_))
def _tool0(name,args):
    _s,_r=req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":"TOOL:"+json.dumps({"name":name,"args":args})}]})
    return _r
_c0=((_tool0("propose_shipping_label",{"order_id":"ord_over_0"}).get("actions")) or [None])[0]
check("weights: box defaults to 3.5 oz until set (4.5 + 3.5 = 8 oz)", _c0 and _c0["request"]["body"]["weightOz"]==8 and "box & packing (3.5 oz)" in " ".join(_c0["lines"]), _c0)
s_,T0=req("/api/admin/today?fresh=1")
check("Today: reminds to check the default box weight", any(t["task"].startswith("Check the box & packing weight") for t in T0.get("tasks",[])), [t["task"] for t in T0.get("tasks",[])])
s_,r_=req("/api/admin/settings", {"partial":True,"packagingOz":3})
check("weights: box & packing saved", s_==200 and r_["settings"].get("packagingOz")==3, r_)
s_,r_=req("/api/admin/settings", {"bundleRuleEnabled":False,"bundleRuleMinItems":3,"bundleRulePercent":10,"loyaltyEnabled":True,"pointsPerDollar":1,"pointsPerDollarRedeemed":100,"minPointsToRedeem":100})
check("weights: saving the loyalty form doesn't wipe the box weight", s_==200 and r_["settings"].get("packagingOz")==3, r_)
def _tool2(name,args):
    _s,_r=req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":"TOOL:"+json.dumps({"name":name,"args":args})}]})
    return _r
_r=_tool2("propose_shipping_label",{"order_id":"ord_over_0"})
_c=(_r.get("actions") or [None])[0]
check("label card: weight worked out from products (1 × 4.5 oz + 3 oz box = 7.5 oz)", _c and _c["request"]["body"]["weightOz"]==7.5 and "from product weights" in " ".join(_c["lines"]), _r)
_r=_tool2("propose_shipping_label",{"order_id":"ord_over_0","weight_oz":11})
_c=(_r.get("actions") or [None])[0]
check("label card: a weight staff give wins", _c and _c["request"]["body"]["weightOz"]==11, _r)
_o=json.load(open(D+"orders.json"))
_o.append({"id":"ord_unweighed","userId":"retail","userName":"Una Weighed","userEmail":"una@example.com","items":[{"productId":"p_mem","productName":"Secret Member Tincture","price":"$40","quantity":2}],"shippingMethod":"ship","shippingCost":10,"subtotal":80,"total":90,"isInquiry":False,"status":"paid","paymentToken":"tuw","createdAt":NOW-DAYMS,"source":"retail","shippingAddress":{"addressLine1":"1 Main","city":"Portland","state":"OR","postalCode":"97201"}})
json.dump(_o, open(D+"orders.json","w"))
_r=_tool2("propose_shipping_label",{"order_id":"ord_unweighed"})
_c=(_r.get("actions") or [None])[0]
check("label card: missing product weight is flagged, not silently guessed", _c and "GUESSED" in " ".join(_c["lines"]) and "Secret Member Tincture" in " ".join(_c["lines"]), _r)
_r=_tool2("propose_product_weights",{"weights":[{"product":"Secret Member Tincture","oz":3.2}],"packaging_oz":4})
_a=_r.get("actions") or []
check("Concierge: weights card + box card", len(_a)==2 and _a[0]["request"]["body"]["weights"]=={"p_mem":3.2} and _a[1]["request"]["body"]["packagingOz"]==4, _r)
s_,T3=req("/api/admin/today?fresh=1")
check("Today: box-weight reminder gone once it's saved", not any(t["task"].startswith("Check the box & packing weight") for t in T3.get("tasks",[])), [t["task"] for t in T3.get("tasks",[])])
check("Today: products that ship without a weight are flagged", any(t["task"].startswith("Weigh ") for t in T3.get("tasks",[])), [t["task"] for t in T3.get("tasks",[])])
# ---------- Today ticks are shared (server-side), product links + QR codes
s_,T5=req("/api/admin/today?fresh=1")
_id=T5["tasks"][0]["id"]
s_,r_=req("/api/admin/today",{"id":_id,"done":True})
s2_,T6=req("/api/admin/today")
check("Today: a tick is saved on the server and comes back on any device", s_==200 and _id in T6.get("done",[]), (r_, T6.get("done")))
check("Today: item ids stay the same while the numbers change", all(":" not in t["id"] or t["id"].startswith(("event-","moment-","pair-")) for t in T6["tasks"]), [t["id"] for t in T6["tasks"]])
req("/api/admin/today",{"id":_id,"done":False})
s3_,T7=req("/api/admin/today")
check("Today: untick works too", _id not in T7.get("done",[]), T7.get("done"))
s_,_r=req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":"Today item stale-unpaid: List the unpaid orders older than 30 days and prepare cancel cards."}]})
check("Today button reply carries its item, so confirming the cards ticks it off", _r.get("todayKey")=="stale-unpaid" and len(_r.get("actions") or [])==1, _r)
s_,_r=req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":"Today item lapsed: Prepare a win-back."}]})
check("…and a draft carries it too (ticked off once the campaign is sent)", (_r.get("draft") or {}).get("todayKey")=="lapsed", _r)
s_,_r=req("/api/assistant/chat",{"mode":"admin","messages":[{"role":"user","content":"act:settings"}]})
check("…ordinary chats don't", "todayKey" not in _r, _r)
_pl=_tool2("product_links",{"products":["Harmony Blend Extract","nope-not-real"]})
_plr=json.loads(_pl["reply"].split("TOOLRESULT::",1)[1])
check("Concierge: product links + QR image URLs for a product", _plr["links"][0]["link"].endswith("/p/p_pub") and _plr["links"][0]["qr_png"].endswith("/api/qr/product/p_pub") and _plr.get("not_found")==["nope-not-real"], _plr)
_q=urllib.request.urlopen(BASE+"/api/qr/product/p_pub")
_png=_q.read()
check("QR route: a real PNG for a real product", _q.headers.get("content-type")=="image/png" and _png[:8]==b"\x89PNG\r\n\x1a\n" and len(_png)>200, (_q.headers.get("content-type"), len(_png)))
try:
    urllib.request.urlopen(BASE+"/api/qr/product/not-a-product"); _code=200
except urllib.error.HTTPError as e: _code=e.code
check("QR route: only for real products (can't make codes for any address)", _code==404, _code)
n_=len(mailbox())
s_,r_=req("/api/admin/campaigns",{"subject":"QR test","body":"Scan me\n\n![QR code for Harmony](https://www.example.com/api/qr/product/p_pub)","testOnly":True})
_h=[m for m in mailbox()[n_:]][-1]["html"]
check("Campaign emails show a QR image line as a picture", '<img src="https://www.example.com/api/qr/product/p_pub"' in _h, _h[-600:])
print(f"{sum(results)}/{len(results)} passed")
