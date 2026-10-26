import json, urllib.request, time, os
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:500]}"))
def req(path, body=None, cookie=ADMIN, method=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json")
    # Each request from its own address, so the per-visitor checkout limit (12 / 10 min) doesn't kick in.
    global _n; _n=globals().get("_n",0)+1; r.add_header("x-forwarded-for", f"10.77.{_n//250}.{_n%250+1}")
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def mail():
    with urllib.request.urlopen(GW+"/__mail") as r: return json.loads(r.read())
def order(oid): return [o for o in json.load(open(D+"orders.json")) if o["id"]==oid][0]

prods=json.load(open(D+"products.json"))
prods+=[
 {"id":"c_sac","name":"Sacred Immunity Capsules","description":"x","price":"$30","image":"x","category":"Capsules","visibility":"both","createdAt":2},
 {"id":"c_rev","name":"Revive Capsules","description":"x","price":"$25","image":"x","category":"Capsules","visibility":"both","createdAt":2},
 {"id":"c_thr","name":"Thrive Capsules","description":"x","price":"$25","salePrice":"$20","image":"x","category":"Capsules","visibility":"both","createdAt":2},
 {"id":"c_har","name":"Harmony Capsules","description":"x","price":"$20","promo":{"type":"bogo","percent":50},"image":"x","category":"Capsules","visibility":"both","createdAt":2},
]
json.dump(prods, open(D+"products.json","w"))
FOUR=["c_sac","c_rev","c_thr","c_har"]
def buy(qty, code=None, points=None, extra=None):
    items=[{"productId":p,"quantity":q} for p,q in zip(FOUR,qty) if q>0]+(extra or [])
    b={"items":items,"shippingMethod":"pickup","paymentMethod":"invoice"}
    if code: b["discountCode"]=code
    if points: b["redeemPoints"]=points
    s,r=req("/api/checkout", b, cookie=MEMBER)
    return s, r, (order(r["orderId"]) if s==200 else None)

# --- admin: create (flag off)
s,r=req("/api/admin/bundles", {"name":"Immunity Foundations","type":"percent","value":20,"items":[{"productId":p,"qty":1} for p in FOUR]})
B4=r.get("bundle",{}).get("id")
check("admin: create the 4-capsule 20% bundle", s==200 and B4, (s,r))
for bad,why in [({"name":"x","type":"percent","value":20,"items":[{"productId":"c_sac","qty":1}]},"one item"),
                ({"name":"x","type":"percent","value":95,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]},"95%"),
                ({"name":"x","type":"percent","value":20,"items":[{"productId":"nope","qty":1},{"productId":"c_rev","qty":1}]},"unknown product"),
                ({"name":"x","type":"price","value":0,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]},"$0 set price"),
                ({"name":"x","type":"percent","value":10,"startsAt":2000,"endsAt":1000,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]},"end before start")]:
    s,r=req("/api/admin/bundles", bad)
    check(f"admin: refuses a bad bundle ({why})", s==400, (s,r))
s,r=req("/api/admin/bundles", {"name":"x","type":"percent","value":20,"items":[]}, cookie=MEMBER)
check("admin: members can't create bundles", s==401)
s,r,o=buy([1,1,1,1])
check("switch off: bundle doesn't price the cart", s==200 and o["total"]==95 and "bundles" not in o, (s,r,o))
s,r=req("/api/bundles", cookie=MEMBER)
check("switch off: storefront gets no bundles", r=={"bundles":[]}, r)

# --- switch on
req("/api/admin/flags", {"key":"bundles_specific_products","on":True})
s,r=req("/api/bundles", cookie=MEMBER); s2,r2=req("/api/bundles", cookie=None)
check("storefront: members and the public shop see the bundle", len(r["bundles"])==1 and len(r2["bundles"])==1, (r,r2))
n=len(mail())
s,r,o=buy([1,1,1,1])
check("the example: 4 capsules, 20% off → $95 set costs $76", s==200 and o["subtotal"]==95 and o["bundleSavings"]==19 and o["discount"]==19 and o["total"]==76, (s,r,o))
check("order records which bundle applied", o and o["bundles"]==[{"id":B4,"name":"Immunity Foundations","sets":1,"savings":19}], o and o.get("bundles"))
inv=[m for m in mail()[n:] if "Your invoice" in m.get("subject","")]
check("invoice shows the bundle line", inv and "Immunity Foundations bundle: <strong>−$19.00" in inv[0]["html"], inv and inv[0]["html"][inv[0]["html"].find("Subtotal"):][:500])
check("sale price respected (Thrive at its $20 sale price inside the set)", o and o["items"][2]["price"]=="$20")
s,r,o=buy([1,1,1,0])
check("remove one product → no bundle, normal price", s==200 and o["total"]==75 and "bundles" not in o and not o.get("discount"), o)
s,r,o=buy([2,2,2,2])
check("two full sets → applied twice; BOGO doesn't stack on bundle items", s==200 and o["bundleSavings"]==38 and o["discount"]==38 and o["total"]==152 and o["bundles"][0]["sets"]==2, o)
s,r,o=buy([1,1,1,2])
check("a partial second set gets nothing extra", o["bundleSavings"]==19 and o["discount"]==19 and o["total"]==96, o)
s,r,o=buy([1,1,1,3])
check("leftover items keep their own promo (BOGO on the 2 extra Harmony)", o["discount"]==29 and o["total"]==106, o)

# --- cart-wide rule interplay
req("/api/admin/settings", {"partial":True,"bundleRuleEnabled":True,"bundleRuleMinItems":3,"bundleRulePercent":10})
s,r,o=buy([1,1,1,1])
check("bundle beats the 'buy 3, save 10%' rule for its items", o["discount"]==19 and o["total"]==76, o)
s,r,o=buy([1,1,1,1], extra=[{"productId":"p_pub","quantity":3}])
check("the rule still applies to the other items (3 × $24.99 → 10%)", o["bundleSavings"]==19 and abs(o["discount"]-26.5)<0.001 and abs(o["total"]-143.47)<0.001, o)
s,r,o=buy([0,0,0,0], extra=[{"productId":"p_pub","quantity":3}])
check("no bundle in cart → rule exactly as before", abs(o["discount"]-7.5)<0.001 and abs(o["total"]-67.47)<0.001, o)
req("/api/admin/settings", {"partial":True,"bundleRuleEnabled":False})

# --- codes and points
s,r=req("/api/admin/discounts", {"code":"FALL10","type":"percentage","value":10})
check("setup: a discount code", s==200, (s,r))
s,r,o=buy([1,1,1,1], code="FALL10")
check("bundle OR code: a code is refused while a bundle applies", s==400 and "bundle" in r.get("error","").lower(), (s,r))
s,r,o=buy([1,1,1,0], code="FALL10")
check("without a bundle the code works as before", s==200 and o["discountCode"]=="FALL10" and o["total"]==67.5, (s,r,o))
req("/api/admin/settings", {"partial":True,"loyaltyEnabled":True,"pointsPerDollarRedeemed":100,"minPointsToRedeem":100})
s,r,o=buy([1,1,1,1], points=100)
check("loyalty points still work with a bundle", s==200 and o["loyaltyPointsRedeemed"]==100 and o["total"]==75, (s,r,o))
req("/api/admin/settings", {"partial":True,"loyaltyEnabled":False})

# --- best bundle wins
s,r=req("/api/admin/bundles", {"name":"Immunity Duo","type":"price","value":40,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]})
DUO=r["bundle"]["id"]
s,r,o=buy([1,1,1,1])
check("overlap: the bigger saving wins (4-pack $19 beats duo $15)", [b["id"] for b in o["bundles"]]==[B4] and o["total"]==76, o["bundles"])
s,r,o=buy([1,1,1,0])
check("set-price bundle: Sacred + Revive for $40 (saves $15)", o["bundles"]==[{"id":DUO,"name":"Immunity Duo","sets":1,"savings":15}] and o["total"]==60, o)
s,r,o=buy([2,2,1,1])
check("best first, then the next best on what's left", sorted((b["id"],b["sets"]) for b in o["bundles"])==sorted([(B4,1),(DUO,1)]) and o["bundleSavings"]==34 and o["total"]==(150-34), o)
req("/api/admin/bundles", {"id":DUO,"active":False}, method="PATCH")
s,r,o=buy([1,1,1,0])
check("paused bundle doesn't apply", "bundles" not in o and o["total"]==75, o)
now=int(time.time()*1000)
s,r=req("/api/admin/bundles", {"id":DUO,"name":"Immunity Duo","type":"price","value":40,"active":True,"startsAt":now+86400000,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]}, method="PATCH")
s2,r2,o=buy([1,1,1,0])
check("scheduled bundle waits for its start date", s==200 and "bundles" not in o, (s,r,o))
req("/api/admin/bundles", {"id":DUO,"name":"Immunity Duo","type":"price","value":40,"active":True,"endsAt":now-1000,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]}, method="PATCH")
s2,r2,o=buy([1,1,1,0])
check("ended bundle stops", "bundles" not in o, o)
s,r=req("/api/admin/bundles", {"name":"Too dear","type":"price","value":999,"items":[{"productId":"c_sac","qty":1},{"productId":"c_rev","qty":1}]})
s2,r2,o=buy([1,1,0,0])
check("a set price above the normal price never charges more", s==200 and "bundles" not in o and o["total"]==55, o)
req(f"/api/admin/bundles?id={r['bundle']['id']}", method="DELETE")

# --- member-only products stay private
s,r=req("/api/admin/bundles", {"name":"Members Pair","type":"percent","value":15,"items":[{"productId":"p_mem","qty":1},{"productId":"c_sac","qty":1}]})
MP=r["bundle"]["id"]
s1,r1=req("/api/bundles", cookie=MEMBER); s2,r2=req("/api/bundles", cookie=None)
check("bundles with member-only products are hidden from the public shop", any(b["id"]==MP for b in r1["bundles"]) and not any(b["id"]==MP for b in r2["bundles"]), (r1,r2))

# --- public shop
s,r=req("/api/retail/checkout", {"items":[{"productId":p,"quantity":1} for p in FOUR],"name":"Pat Buyer","email":"pat2@example.com","address":{"addressLine1":"1 Main","city":"Portland","state":"AZ","postalCode":"86001"}}, cookie=None)
o=order(r["orderId"]) if s==200 else None
check("public shop: bundle applies too ($76 + $10 shipping)", o and o["bundleSavings"]==19 and o["total"]==86, (s,r,o))

# --- reporting + audit
s,r=req("/api/admin/bundles")
b4=[b for b in r["bundles"] if b["id"]==B4][0]
check("reporting: orders, savings and sales per bundle", b4["stats"]["orders"]>=8 and b4["stats"]["savings"]>=19*8 and b4["preview"]=={"cost":95,"savings":19}, b4["stats"])
aud=[json.loads(l) for l in open(D+"audit.jsonl")]
check("activity log: bundle changes recorded", {"bundle.create","bundle.update","bundle.delete"} <= {a["action"] for a in aud})
s,r=req(f"/api/admin/bundles?id={MP}", method="DELETE")
s2,r2=req(f"/api/admin/bundles?id={MP}", method="DELETE")
check("delete (once)", s==200 and s2==404)
req("/api/admin/flags", {"key":"bundles_specific_products","on":False})
s,r,o=buy([1,1,1,1])
check("switch off again → back to normal pricing instantly", o["total"]==95 and "bundles" not in o, o)
print(f"\n{sum(res)}/{len(res)} passed")
