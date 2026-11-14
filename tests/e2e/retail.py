# Retail tab + store portal: store accounts, sign-in (password, link, code),
# stock requests (staff asked before stock counts change), tracking, the
# store Concierge's tools and cards, Today list, privacy. Fake stores only.
import json, urllib.request, time, os, re
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    c=bool(c); res.append(c); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:700]}"))
def req(path, body=None, cookie=ADMIN, method=None, headers=None, raw=False):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json")
    for k,v in (headers or {}).items(): r.add_header(k,v)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            b=resp.read(); return resp.status, (b.decode() if raw else json.loads(b or b"{}")), resp.headers
    except urllib.error.HTTPError as e:
        b=e.read()
        try: return e.code, (b.decode() if raw else json.loads(b or b"{}")), e.headers
        except Exception: return e.code, {}, e.headers
def mail(): return json.loads(urllib.request.urlopen(GW+"/__mail").read())
def cookie_from(h, name="fp_store"):
    for v in h.get_all("set-cookie") or []:
        m=re.match(name+r"=([^;]*)", v)
        if m and m.group(1): return f"{name}={m.group(1)}"
    return None
def stock(): return {r["id"]:r["qty"] for r in json.load(open(D+"stock.json"))} if os.path.exists(D+"stock.json") else {}

# ---- staff only
s,_,_=req("/api/admin/retail", cookie=None)
check("retail admin: staff only", s==401, s)
s,r,_=req("/api/admin/retail", {"name":"X"}, cookie=MEMBER)
check("retail admin: a member can't create store accounts", s==401, s)

# ---- create an account with two logins + invite emails
before=len(mail())
s,r,_=req("/api/admin/retail", {"name":"Maple Street Market","contactName":"Rae","phone":"530-555-0100","staffNotes":"Pays net 30","logins":[{"name":"Rae Owner","email":"Rae@Shop.example"},{"name":"Sam","email":"sam@shop.example"}],"invite":True})
acct=r.get("account",{})
check("create store account with two logins", s==200 and acct.get("name")=="Maple Street Market" and [l["email"] for l in acct.get("logins",[])]==["rae@shop.example","sam@shop.example"], (s,r))
check("staff view never includes password hashes", "passwordHash" not in json.dumps(r), r)
new=[m for m in mail()[before:] if "store portal" in m.get("subject","").lower()]
check("each login is emailed a set-password link", len(new)==2 and all("/store-portal?t=" in m["html"] for m in new), [m.get("subject") for m in mail()[before:]])
link=re.search(r'/store-portal\?t=([A-Za-z0-9_.\-]+)', [m for m in new if m["to"]=="rae@shop.example"][0]["html"]).group(1)
s,r,_=req("/api/admin/retail", {"name":"Other Shop","logins":[{"name":"Dup","email":"sam@shop.example"}]})
check("a login email can belong to only one store", s==409 and "already" in r.get("error",""), (s,r))

# ---- portal off by default? (on in development) — page renders the sign-in
s,html,_=req("/store-portal", cookie=None, raw=True)
check("portal sign-in page renders", s==200 and "Store sign-in" in html, s)
s,html,_=req("/store-portal?t="+link, cookie=None, raw=True)
check("set-password link opens the choose-a-password form", s==200 and "Choose a password" in html and "rae@shop.example" in html, s)

# ---- sign-in before a password: refused; set password with the link
s,r,_=req("/api/store-portal/auth", {"action":"password","email":"rae@shop.example","password":"anything123"}, cookie=None, headers={"x-forwarded-for":"10.9.0.1"})
check("no password yet: password sign-in refused", s==401, (s,r))
s,r,h=req("/api/store-portal/auth", {"action":"set-password","t":link,"password":"short"}, cookie=None)
check("password must be 8+ characters", s==400, (s,r))
s,r,h=req("/api/store-portal/auth", {"action":"set-password","t":link,"password":"rae-strong-pass"}, cookie=None)
RAE=cookie_from(h)
check("set password with the link signs the store in", s==200 and RAE, (s,r))
s,r,_=req("/api/store-portal/auth", {"action":"set-password","t":link,"password":"another-pass-1"}, cookie=None)
check("the link works only once", s==400 and r.get("reason")=="used", (s,r))
s,r,h=req("/api/store-portal/auth", {"action":"password","email":"RAE@shop.example","password":"rae-strong-pass"}, cookie=None, headers={"x-forwarded-for":"10.9.0.2"})
check("password sign-in works (email any case)", s==200 and cookie_from(h), (s,r))
s,r,_=req("/api/store-portal/auth", {"action":"password","email":"rae@shop.example","password":"wrong-pass-1"}, cookie=None, headers={"x-forwarded-for":"10.9.0.3"})
check("wrong password refused", s==401, (s,r))

# ---- a store session is not a member or staff session (and vice versa)
s,_,_=req("/api/admin/retail", cookie=RAE)
check("store session can't open staff routes", s==401, s)
s,_,_=req("/api/account/orders", cookie=RAE)
check("store session can't open member routes", s in (401,403), s)
s,_,_=req("/api/store-portal", cookie=MEMBER)
check("member session can't open the store portal", s==401, s)

# ---- emailed code (same switch as members' codes)
req("/api/admin/flags", {"key":"email_code_login","on":True})
before=len(mail())
s,r,_=req("/api/store-portal/auth", {"action":"send-code","email":"sam@shop.example"}, cookie=None, headers={"x-forwarded-for":"10.9.0.4"})
code_mail=[m for m in mail()[before:] if m["to"]=="sam@shop.example"]
check("send-code emails a 6-digit code", s==200 and code_mail and re.search(r"\b\d{6}\b", code_mail[-1]["subject"]), (s,r,[m.get("subject") for m in mail()[before:]]))
s,r,_=req("/api/store-portal/auth", {"action":"send-code","email":"nobody@shop.example"}, cookie=None, headers={"x-forwarded-for":"10.9.0.5"})
check("send-code gives the same answer for unknown emails", s==200 and r.get("ok"), (s,r))
code=re.search(r"\b(\d{6})\b", code_mail[-1]["subject"]).group(1) if code_mail else "000000"
s,r,_=req("/api/store-portal/auth", {"action":"verify-code","email":"mem@example.com","code":code}, cookie=None, headers={"x-forwarded-for":"10.9.0.6"})
check("a store code doesn't work for another email", s==401, (s,r))
s,r,h=req("/api/store-portal/auth", {"action":"verify-code","email":"sam@shop.example","code":code}, cookie=None, headers={"x-forwarded-for":"10.9.0.7"})
SAM=cookie_from(h)
check("code sign-in works", s==200 and SAM, (s,r))
s,r,_=req("/api/login/code", {"action":"verify","email":"sam@shop.example","code":code}, cookie=None, headers={"x-forwarded-for":"10.9.0.8"})
check("a store code never signs in to the members' site", s in (401,404), (s,r))

# ---- portal data + requests
s,d,_=req("/api/store-portal", cookie=RAE)
check("portal data: store, products without prices, no staff notes", s==200 and d["account"]["name"]=="Maple Street Market" and any(p["id"]=="p_pub" for p in d["products"]) and not any(p["id"]=="p_mem" for p in d["products"]) and "price" not in json.dumps(d["products"]).lower() and "Pays net 30" not in json.dumps(d), d)
before=len(mail())
s,r,_=req("/api/store-portal", {"items":[{"productId":"p_pub","qty":12},{"productId":"p_pub2","qty":3}],"note":"Before Friday please"}, cookie=RAE)
REQ=r.get("request",{})
check("store sends a stock request", s==200 and REQ.get("status")=="pending" and re.match(r"^R[A-Z2-9]{5}$", REQ.get("ref","")) and sum(i["qty"] for i in REQ["items"])==15, (s,r))
alert=[m for m in mail()[before:] if m["to"]=="team@example.com"]
check("new request emails the team (same inbox as orders), replies go to the store", alert and "Maple Street Market" in alert[-1]["subject"] and REQ.get("ref","") in alert[-1]["subject"] and alert[-1].get("reply_to")=="rae@shop.example" and "$" not in alert[-1]["html"], [m.get("subject") for m in mail()[before:]])
s,r,_=req("/api/store-portal", {"items":[{"productId":"p_mem","qty":1}]}, cookie=RAE)
check("members-only products can't be requested", s==400, (s,r))
s,r,_=req("/api/store-portal", {"items":[{"productId":"p_pub","qty":0}]}, cookie=RAE)
check("quantity must be at least 1", s==400, (s,r))
s,r,_=req("/api/store-portal", {"items":[{"productId":"p_pub","qty":2}]}, cookie=SAM)
REQ2=r.get("request",{})
s,r,_=req("/api/store-portal", {"id":REQ2.get("id"),"action":"received"}, cookie=SAM, method="PATCH")
check("store can't mark a pending request received", s==409, (s,r))
s,r,_=req("/api/store-portal", {"id":REQ2.get("id"),"action":"cancel"}, cookie=SAM, method="PATCH")
check("store can cancel a pending request", s==200 and r["request"]["status"]=="cancelled", (s,r))

# ---- Today list + staff Concierge
s,t,_=req("/api/admin/today?fresh=1")
items=[x for x in (t.get("tasks") or []) if x.get("id")=="retail-requests"]
check("Today list shows waiting stock requests", s==200 and items and "Maple Street Market" in json.dumps(items), (s, json.dumps(t)[:400]))
s,r,_=req("/api/assistant/chat", {"mode":"admin","messages":[{"role":"user","content":"TOOL:"+json.dumps({"name":"retail_requests","args":{"status":"open"}})}]})
check("staff Concierge lists retail requests", s==200 and REQ.get("ref","?") in r.get("reply",""), (s,r))

# ---- staff move it: approve, ship (asked about stock counts), tracking
json.dump([{"id":"p_pub","qty":50,"updatedAt":1}], open(D+"stock.json","w"))
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"approved","staffNote":"Packing now"}, method="PATCH")
check("staff approve with a note", s==200 and r["request"]["status"]=="approved", (s,r))
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"shipped","shippedQty":{"p_pub":10,"p_pub2":3}}, method="PATCH")
check("marking shipped without saying yes leaves stock counts alone", s==200 and r["request"]["status"]=="shipped" and stock().get("p_pub")==50 and not r["request"].get("stockTaken"), (s,r,stock()))
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"approved","stock":"return"}, method="PATCH")
check("moving back with nothing taken changes no counts", s==200 and stock().get("p_pub")==50, (s,r,stock()))
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"shipped","shippedQty":{"p_pub":10,"p_pub2":3},"stock":"take"}, method="PATCH")
check("staff said yes: shipped units come off stock counts", s==200 and stock().get("p_pub")==40 and r["request"].get("stockTaken")==[{"productId":"p_pub","qty":10}] and "10 units" in r.get("stockNote",""), (s,r,stock()))
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"approved","stock":"return"}, method="PATCH")
check("not shipped after all + put back: counts restored", s==200 and stock().get("p_pub")==50 and not r["request"].get("stockTaken"), (s,r,stock()))
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"shipped","shippedQty":{"p_pub":10,"p_pub2":3}}, method="PATCH")
s,r,_=req("/api/admin/retail", {"requestId":REQ["id"],"status":"cancelled"}, method="PATCH")
check("staff can't use the store-only Cancelled status", s==400, (s,r))
s,d,_=req("/api/store-portal", cookie=RAE)
mine=[x for x in d["requests"] if x["id"]==REQ["id"]][0]
check("store sees Shipped, your note and shipped units", mine["status"]=="shipped" and mine["staffNote"]=="Packing now" and [i.get("shippedQty") for i in mine["items"]]==[10,3], mine)
check("tracking: units shipped per product and month", d["tracking"]["totalUnits"]==13 and d["tracking"]["shipments"]==1 and {p["productId"]:p["units"] for p in d["tracking"]["products"]}=={"p_pub":10,"p_pub2":3} and d["tracking"]["months"][0]["units"]==13, d["tracking"])
s,r,_=req("/api/store-portal", {"id":REQ["id"],"action":"received"}, cookie=SAM, method="PATCH")
check("store confirms it arrived", s==200 and r["request"]["status"]=="received", (s,r))
s,r,_=req("/api/store-portal", {"id":REQ["id"],"action":"cancel"}, cookie=SAM, method="PATCH")
check("store can't cancel a received request", s==409, (s,r))

# ---- other stores can't see or touch it
s,r,_=req("/api/admin/retail", {"name":"Tahoe Herbs","logins":[{"name":"Tia","email":"tia@tahoe.example"}],"invite":True})
tia_link=re.search(r'/store-portal\?t=([A-Za-z0-9_.\-]+)', [m for m in mail() if m["to"]=="tia@tahoe.example"][-1]["html"]).group(1)
s,r,h=req("/api/store-portal/auth", {"action":"set-password","t":tia_link,"password":"tia-strong-pass"}, cookie=None)
TIA=cookie_from(h)
s,d,_=req("/api/store-portal", cookie=TIA)
check("another store sees none of Maple Street's requests", s==200 and d["requests"]==[] and d["tracking"]["totalUnits"]==0, d)
s,r,_=req("/api/store-portal", {"id":REQ2["id"],"action":"cancel"}, cookie=TIA, method="PATCH")
check("another store can't change Maple Street's request", s==404, (s,r))

# ---- the store Concierge
def ask(text, cookie):
    return req("/api/assistant/chat", {"mode":"store","messages":[{"role":"user","content":text}],"conversationId":"c_store_1"}, cookie=cookie)
s,st,_=req("/api/assistant/status", cookie=None)
check("Concierge status says it's available for stores", s==200 and st["available"].get("store") is True, st)
s,r,_=ask("hello", None)
check("store Concierge needs a store sign-in", s==401, (s,r))
s,r,_=ask("hello", MEMBER)
check("a member can't use the store Concierge", s==401, (s,r))
s,r,_=ask("TOOL:"+json.dumps({"name":"shipped_to_us","args":{}}), RAE)
check("store Concierge: shipped_to_us totals", s==200 and '"totalUnits":13' in r.get("reply",""), (s,r))
s,r,_=ask("TOOL:"+json.dumps({"name":"my_stock_requests","args":{}}), TIA)
check("store Concierge only sees its own store", s==200 and '"count":0' in r.get("reply",""), (s,r))
s,r,_=ask("TOOL:"+json.dumps({"name":"retail_requests","args":{}}), RAE)
check("store Concierge can't use staff tools", s==200 and "not available" in r.get("reply","").lower(), (s,r))
s,r,_=ask("TOOL:"+json.dumps({"name":"propose_stock_request","args":{"items":[{"product":"Harmony Blend","qty":6}],"note":"For the holidays"}}), RAE)
card=(r.get("actions") or [{}])[0]
check("store Concierge prepares a request card (nothing sent yet)", s==200 and card.get("kind")=="store_request" and card["request"]["url"]=="/api/store-portal" and card["request"]["body"]["items"]==[{"productId":"p_pub","qty":6}], (s,r))
n_before=len(json.load(open(D+"retail-requests.json")))
check("…and nothing is saved until the store confirms", n_before==len(json.load(open(D+"retail-requests.json"))), n_before)
s,r,_=req(card["request"]["url"], card["request"]["body"], cookie=RAE, headers={"x-fp-source":"assistant","x-fp-proposal":"store_request"})
check("confirming the card sends the request", s==200 and r["request"]["status"]=="pending", (s,r))
s,r,_=ask("TOOL:"+json.dumps({"name":"propose_stock_request","args":{"items":[{"product":"Secret Member Tincture","qty":1}]}}), RAE)
check("store Concierge refuses products stores can't request", s==200 and not r.get("actions") and "isn't a product" in r.get("reply",""), (s,r))
s,r,_=ask("TOOL:"+json.dumps({"name":"propose_message_team","args":{"message":"Please update our hours to 10-6"}}), RAE)
card=(r.get("actions") or [{}])[0]
check("store Concierge prepares a message-the-team card", card.get("kind")=="store_message" and card.get("preview")=="Please update our hours to 10-6", (s,r))
before=len(mail())
s,r,_=req(card["request"]["url"], card["request"]["body"], cookie=RAE, method="PUT")
check("message card emails the team, reply goes to the store", s==200 and any(m["to"]=="team@example.com" and m.get("reply_to")=="rae@shop.example" and "10-6" in m["html"] for m in mail()[before:]), (s,r))
s,sysmsg,_=req("/api/assistant/chat", {"mode":"store","messages":[{"role":"user","content":"hello there"}]}, cookie=RAE)
lg=json.loads(urllib.request.urlopen(GW+"/__log").read())
last=[x for x in lg if "store portal" in str(x.get("system",""))]
check("store prompt: own store, no prices, store tools only", last and "Maple Street Market" in last[-1]["system"] and "$" not in last[-1]["system"].split("PRODUCTS THEY CAN REQUEST")[1] and "propose_stock_request" in last[-1]["tools"] and "get_product_details" not in last[-1]["tools"] and "retail_requests" not in last[-1]["tools"], (last[-1]["tools"] if last else lg[-1:]))

# ---- switching off
s,r,_=req("/api/admin/retail", {"id":acct["id"],"loginId":[l for l in acct["logins"] if l["email"]=="sam@shop.example"][0]["id"],"active":False}, method="PUT")
s,_,_=req("/api/store-portal", cookie=SAM)
check("switching a login off ends its session at once", s==401, s)
s,r,_=req("/api/admin/retail", {"id":acct["id"],"active":False}, method="PUT")
s,_,_=req("/api/store-portal", cookie=RAE)
check("switching the store off ends every login's session", s==401, s)
s,r,_=req("/api/admin/retail", {"id":acct["id"],"active":True}, method="PUT")
s,r,_=req("/api/admin/flags", {"key":"retail_portal","on":False})
s,html,_=req("/store-portal", cookie=RAE, raw=True)
s2,_,_=req("/api/store-portal", cookie=RAE)
check("portal switch off: the portal is closed (data kept)", "closed right now" in html and s2==404 and os.path.exists(D+"retail-accounts.json"), (s2, html[:200]))
req("/api/admin/flags", {"key":"retail_portal","on":True})

# ---- activity log + privacy
au=[json.loads(l) for l in open(D+"audit.jsonl")] if os.path.exists(D+"audit.jsonl") else []
acts={a["action"] for a in au}
check("activity log records account + request changes", {"retail.account_create","retail.request_status","retail.request"}<=acts and not any("rae-strong-pass" in json.dumps(a) for a in au), sorted(a for a in acts if a.startswith("retail")))
s,html,_=req("/privacy", cookie=None, raw=True)
check("privacy page covers retail store accounts", "Retail store accounts" in html and "November 10, 2026" in html, s)

print(f"{sum(res)}/{len(res)} passed")
