# Ambassador panel: an ambassador is an approved member whose
# email staff link in the Ambassadors tab. They sign in the usual ways and land on
# /ambassador: their own numbers only (no customer names), their picks, and they
# can still shop. Switch ambassador_panel.
import json, urllib.request, os, re, time
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); T2=json.load(open("/tmp/harness/tokens19.json"))
ADMIN=f"gallery_admin={T['admin']}"; MIA=f"gallery_visitor={T['member']}"; AMY=f"gallery_visitor={T2['amy']}"; STAFF_AS=f"gallery_visitor={T2['staffAs']}"
now=int(time.time()*1000); DAY=86400000
res=[]
def check(n,c,d=""):
    c=bool(c); res.append(c); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:700]}"))
def req(path, body=None, cookie=ADMIN, method=None, raw=False, headers=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json")
    for k,v in (headers or {}).items(): r.add_header(k,v)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            b=resp.read(); return resp.status, (b.decode() if raw else json.loads(b or b"{}"))
    except urllib.error.HTTPError as e:
        b=e.read()
        try: return e.code, (b.decode() if raw else json.loads(b or b"{}"))
        except Exception: return e.code, {}
class _NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
def where(path, cookie=None):
    r=urllib.request.Request(BASE+path)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.build_opener(_NoRedir).open(r, timeout=60) as resp: return resp.status, ""
    except urllib.error.HTTPError as e: return e.code, e.headers.get("location","")
def mail(): return json.loads(urllib.request.urlopen(GW+"/__mail").read())
def audit(): return [json.loads(l) for l in open(D+"audit.jsonl")] if os.path.exists(D+"audit.jsonl") else []

# ---- the switch is listed and on for stage
s,f=req("/api/admin/flags")
fl=[x for x in f.get("flags",[]) if x["key"]=="ambassador_panel"]
check("switch: Ambassador panel is listed, on for stage/dev", fl and fl[0]["on"] is True, fl)

# ---- an ambassador linked to Mia (mem@example.com)
s,x=req("/api/admin/ambassadors", {"name":"Maya Rose","slug":"mayarose","email":"maya@example.com","account":"not an email","productIds":["p_pub"]})
check("staff: a bad panel sign-in email is refused", s==400 and "panel sign-in" in x.get("error",""), (s,x))
s,x=req("/api/admin/ambassadors", {"name":"Maya Rose","slug":"mayarose","email":"maya@example.com","account":" MEM@Example.com ","productIds":["p_pub"],"terms":{"commissionPct":12,"growthPct":20,"growthGoal":"30 orders a month","trialDays":90,"startDate":"2026-01-01","windowDays":30,"payoutSchedule":"monthly","notes":"STAFF ONLY NOTE"}})
amb=x.get("ambassador") or {}
check("staff: link a member email (trimmed, lower-cased)", s==200 and amb.get("account")=="mem@example.com", (s,x))
s,x=req("/api/admin/ambassadors", {"name":"Other Person","slug":"otherperson","account":"mem@example.com"})
check("staff: one email opens only one panel", s==400 and "already opens" in x.get("error",""), (s,x))
s,x=req("/api/admin/ambassadors")
check("staff: the tab shows the linked email is an approved member", x.get("accounts",{}).get(amb["id"])=="approved", x.get("accounts"))
base={k:v for k,v in amb.items() if k!="account"}
s,x=req("/api/admin/ambassadors", {**base,"id":amb["id"]}, method="PUT")
check("staff: saving without the field (older form, Concierge) keeps the link", s==200 and x["ambassador"].get("account")=="mem@example.com", x.get("ambassador",{}).get("account"))
check("staff: the link is in the Activity log", any(a.get("action")=="ambassador.create" and (a.get("after") or {}).get("panelSignIn")=="mem@example.com" for a in audit()), [a.get("after") for a in audit()][:3])

# ---- orders credited to her: two from other people, one cancelled
o=json.load(open(D+"orders.json"))
AMB={"id":amb["id"],"slug":"mayarose","name":"Maya Rose","rate":12}
o.append({"id":"ord_9_mayaaa","userId":"retail","userName":"Pat Buyer","userEmail":"pat@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":2}],"shippingMethod":"ship","shippingCost":10,"subtotal":49.98,"total":59.98,"isInquiry":False,"status":"paid","paymentToken":"tx","createdAt":now-2*DAY,"source":"retail","shippingAddress":"1 Secret Lane","ambassador":{**AMB,"via":"page"}})
o.append({"id":"ord_9_mayabb","userId":"u_x","userName":"Quinn Quiet","userEmail":"quinn@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":24.99,"total":24.99,"isInquiry":False,"status":"pending","paymentToken":"ty","createdAt":now-1*DAY,"source":"member","ambassador":{**AMB,"via":"code"}})
o.append({"id":"ord_9_mayacc","userId":"u_y","userName":"Cass Cancel","userEmail":"cass@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":24.99,"total":24.99,"isInquiry":False,"status":"cancelled","paymentToken":"tz","createdAt":now-1*DAY,"source":"member","ambassador":{**AMB,"via":"page"}})
json.dump(o,open(D+"orders.json","w"))
s,x=req(f"/api/admin/ambassadors", {"id":amb["id"],"payout":{"amount":5,"note":"Venmo, internal note"}}, method="PUT")

# ---- counters: a visit, a product opened on her page, a membership request from her visitors
s,_=req("/mayarose", cookie=None, raw=True, headers={"user-agent":"Mozilla/5.0 (iPhone)"})
req("/api/t", {"e":"product_view","p":{"id":"p_pub","amb":amb["id"]}}, cookie=None, headers={"user-agent":"Mozilla/5.0 (iPhone)"})
req("/api/t", {"e":"product_view","p":{"id":"p_pub","amb":"<script>"}}, cookie=None, headers={"user-agent":"Mozilla/5.0 (iPhone)"})
s,x=req("/api/signup", {"name":"Jo Joiner","email":"jo.joiner@example.com","password":"longenough123","ageVerified":True,"ambassador":{"slug":"mayarose","at":now-DAY}}, cookie=None, headers={"x-forwarded-for":"9.9.19.1"})
check("membership request through her page still works", s==200, (s,x))
s,x=req("/api/signup", {"name":"Old Visitor","email":"old.visitor@example.com","password":"longenough123","ageVerified":True,"ambassador":{"slug":"mayarose","at":now-90*DAY}}, cookie=None, headers={"x-forwarded-for":"9.9.19.2"})
users=json.load(open(D+"users.json"))
jo=[u for u in users if u["email"]=="jo.joiner@example.com"]
check("nothing about the ambassador is saved on the new member", jo and "ambassador" not in json.dumps(jo[0]).lower(), jo)

# ---- the panel
s,x=req("/api/ambassador", cookie=None)
check("panel API: signed out = 401", s==401, s)
s,x=req("/api/ambassador", cookie=AMY)
check("panel API: a member who isn't linked = 401", s==401, s)
s,h=req("/ambassador", cookie=AMY, raw=True)
check("panel page: an unlinked member is told it's for ambassadors", s==200 and "This page is for our ambassadors" in h, s)
s,loc=where("/ambassador")
check("panel page: signed out goes to sign-in and comes back", s in (307,308) and loc.endswith("/?next=/ambassador"), (s,loc))
s,d=req("/api/ambassador?range=30", cookie=MIA)
check("panel API: the linked member gets their numbers", s==200 and d["ambassador"]["slug"]=="mayarose" and d["range"]["key"]=="30", (s,str(d)[:300]))
t=d.get("totals",{})
check("panel: orders, sales (paid only, without shipping), pending and commission", t.get("orders")==2 and t.get("sales")==49.98 and t.get("pendingSales")==24.99 and t.get("earned")==6.0 and t.get("pending")==3.0, t)
check("panel: visits, product views and membership requests are counted (outside the window = not counted; junk ids ignored)", t.get("visits")==1 and t.get("views")==1 and t.get("joins")==1, t)
check("panel: all time = earned, paid out and still owed", d["allTime"]=={"earned":6.0,"paidOut":5.0,"owed":1.0,"orders":2}, d.get("allTime"))
check("panel: a chart with one bar per day for 30 days", d["chart"]["unit"]=="day" and len(d["chart"]["points"])==30 and sum(p["orders"] for p in d["chart"]["points"])==2, d.get("chart",{}).get("unit"))
check("panel: compared with the 30 days before", d.get("previous")=={"visits":0,"orders":0,"sales":0,"earned":0}, d.get("previous"))
dump=json.dumps(d)
check("panel: never a customer's name, email or address", all(v not in dump for v in ("Pat Buyer","pat@example.com","Quinn","quinn@example.com","1 Secret Lane","Cass","userEmail","userName","shippingAddress")), [v for v in ("Pat Buyer","pat@example.com","Quinn","1 Secret Lane","userEmail") if v in dump])
check("panel: orders show number, date, status, products and amounts only", d["orders"] and set(d["orders"][0].keys())=={"ref","at","status","items","net","commission","rate","earned","via"} and d["orders"][0]["ref"]=="MAYABB" and d["orders"][0]["status"]=="Awaiting payment", d.get("orders"))
check("panel: cancelled orders are left out", "MAYACC" not in dump)
check("panel: staff-only notes (terms notes, payout notes) never show", "STAFF ONLY NOTE" not in dump and "internal note" not in dump, "")
check("panel: their terms (rate, growth rate and goal, trial)", d["terms"]["rate"]==12 and d["terms"]["growthPct"]==20 and d["terms"]["growthGoal"]=="30 orders a month" and d["terms"]["trial"]["status"] in ("review","done"), d.get("terms"))
check("panel: picks list members-only products, marked", any(p["id"]=="p_mem" and p["membersOnly"] for p in d["picks"]["products"]) and d["picks"]["selected"]==["p_pub"], d.get("picks",{}).get("selected"))
s,d7=req("/api/ambassador?range=7", cookie=MIA)
check("panel: 7 days range", s==200 and len(d7["chart"]["points"])==7 and d7["range"]["key"]=="7", (s,d7.get("range")))
s,da=req("/api/ambassador?range=all", cookie=MIA)
check("panel: all time starts on their start date, by week or month, no comparison", s==200 and da["range"]["from"]=="2026-01-01" and da["chart"]["unit"] in ("week","month") and da["previous"] is None, (s,da.get("range"),da.get("chart",{}).get("unit")))
s,dx=req("/api/ambassador?range=<x>", cookie=MIA)
check("panel: an unknown range falls back to 30 days", s==200 and dx["range"]["key"]=="30", dx.get("range"))
s,h=req("/ambassador", cookie=MIA, raw=True)
check("panel page renders: hello, link, tiles, chart, orders, picks", s==200 and re.search(r"Hi, (<!-- -->)?Maya", h) and "Page visits" in h and "Membership requests" in h and "Commission earned" in h and "Your orders" in h and "Your picks" in h and "Shop as a member" in h, s)
check("panel page: no customer names in the page either", "Pat Buyer" not in h and "pat@example.com" not in h)
s,h=req("/gallery", cookie=MIA, raw=True)
check("members' shop: an ambassador gets a link to their panel (and can still shop)", s==200 and 'href="/ambassador"' in h, s)
s,h=req("/gallery", cookie=AMY, raw=True)
check("members' shop: other members don't", s==200 and 'href="/ambassador"' not in h, s)

# ---- picks
s,x=req("/api/ambassador", {"productIds":["p_mem","p_pub"]}, cookie=MIA, method="PUT")
a=[r for r in req("/api/admin/ambassadors")[1]["ambassadors"] if r["id"]==amb["id"]][0]
check("picks: the ambassador can choose and order their products", s==200 and a["productIds"]==["p_mem","p_pub"], (s,x))
check("picks: nothing else on their record changes", a["terms"]["commissionPct"]==12 and a.get("account")=="mem@example.com" and len(a.get("payouts",[]))==1 and a["email"]=="maya@example.com", a)
s,x=req("/api/ambassador", {"productIds":["p_nope"]}, cookie=MIA, method="PUT")
check("picks: a product that isn't in the shop is refused", s==400, (s,x))
s,x=req("/api/ambassador", {"productIds":["p_pub"],"terms":{"commissionPct":99},"account":"amy@example.com","payouts":[]}, cookie=MIA, method="PUT")
a=[r for r in req("/api/admin/ambassadors")[1]["ambassadors"] if r["id"]==amb["id"]][0]
check("picks: terms, sign-in and payouts can't be changed from the panel", s==200 and a["terms"]["commissionPct"]==12 and a["account"]=="mem@example.com" and len(a["payouts"])==1, a)
s,x=req("/api/ambassador", {"productIds":["p_pub"]}, cookie=AMY, method="PUT")
check("picks: another member can't change them", s==401, s)
pk=[e for e in audit() if e.get("action")=="ambassador.picks"]
check("picks: in the Activity log as the member", pk and pk[0]["actor"]=="mem@example.com" and pk[0]["actorType"]=="member" and pk[0]["after"]["products"]==["p_mem","p_pub"], pk[:1])
s,x=req("/api/ambassador", {"productIds":["p_pub","p_mem"]}, cookie=STAFF_AS, method="PUT")
pk=[e for e in audit() if e.get("action")=="ambassador.picks"]
check("picks: staff using Log in as are recorded as themselves", s==200 and pk[-1]["actor"]=="cam@example.com" and pk[-1]["actorType"]=="admin", pk[-1:])
s,h=req("/mayarose", cookie=None, raw=True)
check("picks: her public page shows the new order (members-only one locked)", s==200 and "Members only" in h, s)

# ---- sign-in lands on the panel
req("/api/admin/flags", {"key":"email_code_login","on":True})
def code_for(email):
    req("/api/login/code", {"action":"send","email":email}, cookie=None)
    for m in reversed(mail()):
        if email in json.dumps(m.get("to")) and "sign-in code" in m.get("subject",""):
            return re.match(r"(\d{6})", m["subject"]).group(1)
c=code_for("mem@example.com")
s,x=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":c}, cookie=None)
check("sign-in: a linked ambassador is sent to their panel", s==200 and x.get("to")=="/ambassador", (s,x))
c=code_for("amy@example.com")
s,x=req("/api/login/code", {"action":"verify","email":"amy@example.com","code":c}, cookie=None)
check("sign-in: other members go to the shop as usual", s==200 and "to" not in x, (s,x))

# ---- page off = no panel; switch off = no panel, normal sign-in
s,x=req("/api/admin/ambassadors", {**{k:v for k,v in a.items()},"active":False}, method="PUT")
s,x=req("/api/ambassador", cookie=MIA)
check("page switched off: the panel closes too", s==401, s)
req("/api/admin/ambassadors", {**{k:v for k,v in a.items()},"active":True}, method="PUT")
req("/api/admin/flags", {"key":"ambassador_panel","on":False})
s,x=req("/api/ambassador", cookie=MIA)
check("switch off: the panel API is closed", s==401, s)
s,h=req("/ambassador", cookie=MIA, raw=True)
check("switch off: the page says it's closed", s==200 and "closed right now" in h, s)
c=code_for("mem@example.com")
s,x=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":c}, cookie=None)
check("switch off: sign-in goes to the shop", s==200 and "to" not in x, (s,x))
s,h=req("/gallery", cookie=MIA, raw=True)
check("switch off: no panel link in the shop", 'href="/ambassador"' not in h)
req("/api/admin/flags", {"key":"ambassador_panel","on":True})

# ---- unlinking
s,x=req("/api/admin/ambassadors", {**a,"active":True,"account":""}, method="PUT")
s2,_=req("/api/ambassador", cookie=MIA)
check("staff: clearing the sign-in email closes the panel", s==200 and not x["ambassador"].get("account") and s2==401, (s,s2))

print(f"\n{sum(res)}/{len(res)} passed")
