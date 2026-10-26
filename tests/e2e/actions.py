import json, urllib.request, time
from datetime import datetime
from zoneinfo import ZoneInfo
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json"))
ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
results=[]
def check(n,c,d=""):
    results.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {d}"))
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
def chat(text, cookie=ADMIN, mode="admin"):
    return req("/api/assistant/chat", {"mode":mode,"messages":[{"role":"user","content":text}]}, cookie)
def confirm(action):
    rq=action["request"]; return req(rq["url"], rq["body"], ADMIN, rq["method"])
prod=lambda pid: next((p for p in json.load(open(D+"products.json")) if p["id"]==pid), None)
jload=lambda f: json.load(open(D+f))

# ---- read
s,r=chat("act:settings")
check("read: site settings", s==200 and "bundle_rule" in r["reply"] and "Fall" not in r["reply"], r)

# ---- percent off, and it can't undo an unrelated edit made after the card
s,r=chat("act:sale-pct"); a=(r.get("actions") or [None])[0]
check("sale %: one card, both products, prices previewed", a and a["title"].startswith("20% off: 2 products") and any("$24.99 → $23.99" in l for l in a["lines"]) and any("$40 → $32" in l for l in a["lines"]), r)
check("sale %: nothing changed before confirm", prod("p_mem").get("promo") is None)
ps=jload("products.json")
for p in ps:
    if p["id"]=="p_pub": p["description"]="EDITED AFTER THE CARD"
json.dump(ps, open(D+"products.json","w"))
s2,r2=confirm(a)
check("sale %: confirm ok", s2==200 and r2.get("ok"), (s2,r2))
pp,pm=prod("p_pub"),prod("p_mem")
check("sale %: promo set, fixed sale price cleared", pp["promo"]=={"type":"percent","percent":20} and "salePrice" not in pp and pm["promo"]["percent"]==20, (pp,pm))
check("sale %: unrelated edit made after the card survives", pp["description"]=="EDITED AFTER THE CARD", pp["description"])
check("sale %: nothing else touched", pp["name"]=="Harmony Blend Extract" and pp["price"]=="$29.99" and pp["visibility"]=="both", pp)

s,r=chat("act:sale-high")
check("sale price above regular refused", not r.get("actions") and "isn't below the regular price" in r["reply"], r)
s,r=chat("act:sale-price"); a=r["actions"][0]
s2,_=confirm(a); pm=prod("p_mem")
check("sale price: $30 set, % promo cleared", s2==200 and pm["salePrice"]=="$30" and "promo" not in pm, pm)
s,r=chat("act:sale-bogo"); a=r["actions"][0]
check("bogo: preview shows 2-for price", any("2nd 50% off" in l for l in a["lines"]), a["lines"])
confirm(a); pp=prod("p_pub")
check("bogo: set", pp["promo"]=={"type":"bogo","percent":50}, pp)
s,r=chat("act:sale-end"); a=r["actions"][0]
confirm(a); pp=prod("p_pub")
check("end sale: back to regular price", "promo" not in pp and "salePrice" not in pp, pp)
s,r=chat("act:sale-end-none")
check("end sale on a product not on sale: no card", not r.get("actions") and "Nothing to do" in r["reply"], r)

# ---- bundles
s,r=chat("act:bundle-public")
check("bundle: can't be public with a members-only item", not r.get("actions") and "members-only" in r["reply"], r)
s,r=chat("act:bundle-one")
check("bundle: needs 2+ products", not r.get("actions") and "at least 2" in r["reply"], r)
n_before=len(jload("products.json"))
s,r=chat("act:bundle"); a=(r.get("actions") or [None])[0]
check("bundle: card with price and saving", a and "$53.99" in " ".join(a["lines"]) and "$59.99" in " ".join(a["lines"]) and "Members only" in " ".join(a["lines"]), r)
s2,r2=confirm(a); ps=jload("products.json"); b=next((p for p in ps if p["name"]=="Calm Duo"),None)
check("bundle: created", s2==200 and b and b["isBundle"] and b["price"]=="$53.99" and b["visibility"]=="internal" and b["category"]=="Bundles" and b["bundleProducts"]==["p_pub","p_mem"], b)
check("bundle: description lists contents", b and "- Harmony Blend Extract" in b["description"] and "- Secret Member Tincture" in b["description"], b and b["description"])
check("bundle: rest of catalog intact", len(ps)==n_before+1 and prod("p_hid") is not None)
s,r=chat("act:bundle")
check("bundle: duplicate name refused", not r.get("actions") and "already exists" in r["reply"], r)

# ---- bundle rule: partial, keeps loyalty settings
s,r=chat("act:rule"); a=r["actions"][0]
check("rule: card", "15% off 3+ items" in a["title"], a)
s2,_=confirm(a); st=jload("settings.json")
check("rule: saved", st["bundleRuleEnabled"] and st["bundleRuleMinItems"]==3 and st["bundleRulePercent"]==15, st)
check("rule: loyalty settings untouched", st["loyaltyEnabled"] is True and st["pointsPerDollar"]==2 and st["minPointsToRedeem"]==250, st)
s,r=chat("act:rule-off"); confirm(r["actions"][0]); st=jload("settings.json")
check("rule: off, numbers kept", st["bundleRuleEnabled"] is False and st["bundleRulePercent"]==15 and st["loyaltyEnabled"] is True, st)
s,r=req("/api/admin/settings", {"partial":True,"bundleRuleEnabled":True})
check("settings: partial needs admin", s==401, s)

# ---- banner: escaped text, keeps colours, Pacific countdown
s,r=chat("act:banner"); a=(r.get("actions") or [None])[0]
check("banner: card", a and "Shop the sale → /retail" in " ".join(a["lines"]) and "Dec 31" in " ".join(a["lines"]), r)
s2,_=confirm(a); bn=jload("banner.json")
want=int(datetime(2026,12,31,18,0,tzinfo=ZoneInfo("America/Los_Angeles")).timestamp()*1000)
check("banner: text is escaped (no HTML from the assistant)", bn["message"]=="Fall sale &lt;b&gt;now&lt;/b&gt; &amp; more", bn["message"])
check("banner: on, link, countdown in Pacific time", bn["enabled"] and bn["linkUrl"]=="/retail" and bn["countdownTo"]==want and bn["countdownLabel"]=="Sale ends in", (bn, want))
check("banner: colours kept", bn["background"]=="#123456" and bn["textColor"]=="#fefefe", bn)
s,r=req("/api/admin/banner")
check("banner: public read shows it", r["banner"]["enabled"] and "Fall sale" in r["banner"]["message"])
s,r=chat("act:banner-bad")
check("banner: unsafe link refused", not r.get("actions") and "link_url" in r["reply"], r)
s,r=chat("act:banner-past")
check("banner: past countdown refused", not r.get("actions") and "future" in r["reply"], r)
s,r=chat("act:banner-off"); confirm(r["actions"][0]); bn=jload("banner.json")
check("banner: off keeps text", bn["enabled"] is False and "Fall sale" in bn["message"] and bn["background"]=="#123456", bn)

# ---- dashboard's full-form saves still work exactly as before
s,r=req("/api/admin/settings", {"bundleRuleEnabled":False,"bundleRuleMinItems":4,"bundleRulePercent":5,"loyaltyEnabled":True,"pointsPerDollar":1,"pointsPerDollarRedeemed":100,"minPointsToRedeem":100}, ADMIN)
st=jload("settings.json")
check("dashboard settings form: full save", s==200 and st["bundleRuleMinItems"]==4 and st["pointsPerDollar"]==1, st)
s,r=req("/api/admin/banner", {"enabled":True,"message":"<strong>Hi</strong>","background":"#000000","textColor":"#ffffff"}, ADMIN)
bn=jload("banner.json")
check("dashboard banner form: full save (HTML allowed for staff, link cleared)", s==200 and bn["message"]=="<strong>Hi</strong>" and "linkUrl" not in bn and bn["background"]=="#000000", bn)

# ---- several cards at once
s,r=chat("act:multi")
check("multi: one card per change", len(r.get("actions") or [])==2 and {x["kind"] for x in r["actions"]}=={"product_sale","banner"}, r.get("actions"))

# ---- customers can't use any of it
s,r=chat("act:sale-pct", cookie=None, mode="site")
check("public: sale tool refused", not r.get("actions") and "not available" in r["reply"], r)
s,r=chat("act:banner", cookie=MEMBER, mode="site")
check("member: banner tool refused", not r.get("actions") and "not available" in r["reply"], r)

# ---- server-side pricing validation
s,r=req("/api/admin/products", {"ids":["p_pub"],"pricing":{"mode":"percent","percent":150}}, ADMIN, "PATCH")
check("pricing: bad percent 400", s==400, (s,r))
s,r=req("/api/admin/products", {"ids":["p_pub"],"pricing":{"mode":"weird"}}, ADMIN, "PATCH")
check("pricing: bad mode 400", s==400, (s,r))
s,r=req("/api/admin/products", {"ids":["nope"],"pricing":{"mode":"clear"}}, ADMIN, "PATCH")
check("pricing: unknown product 404", s==404, (s,r))
s,r=req("/api/admin/products", {"ids":["p_pub"],"pricing":{"mode":"clear"}}, MEMBER, "PATCH")
check("pricing: needs admin", s==401, s)
s,r=req("/api/admin/products", {"ids":["p_hid"],"visibility":"both"}, ADMIN, "PATCH")
check("visibility bulk change still works", s==200 and prod("p_hid")["visibility"]=="both", (s,r))

print(f"\n{sum(results)}/{len(results)} passed")
