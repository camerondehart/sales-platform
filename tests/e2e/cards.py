import json, urllib.request
BASE="http://127.0.0.1:3470"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:500]}"))
def chat(text, cookie=None, mode="site", ip="10.7.0.1"):
    r=urllib.request.Request(BASE+"/api/assistant/chat", data=json.dumps({"mode":mode,"messages":[{"role":"user","content":text}]}).encode(), method="POST")
    r.add_header("content-type","application/json"); r.add_header("x-forwarded-for", ip)
    if cookie: r.add_header("cookie", cookie)
    with urllib.request.urlopen(r, timeout=60) as resp: return json.loads(resp.read())

r=chat("cards:show")
c=(r.get("products") or [])
check("public: recommended product comes back as a card", len(c)==1 and c[0]["id"]=="p_pub" and c[0]["name"]=="Harmony Blend Extract", r)
check("card: sale price, regular price, photo, public shop, can add", c and c[0]["price"]=="$24.99" and c[0]["was"]=="$29.99" and c[0]["image"]=="x" and c[0]["shop"]=="public" and c[0]["canAdd"] is True, c)
check("card: short description", c and c[0].get("blurb","").startswith("A calming daily blend"), c)
check("unknown names are dropped (and the model is told)", "not_found" in r["reply"] and "Unicorn Dust" in r["reply"], r["reply"][:300])
r=chat("cards:secret")
check("public: members-only products never become cards", not r.get("products"), r)
r=chat("cards:secret", cookie=MEMBER)
c=r.get("products") or []
check("member: members' products show, for the members' cart", len(c)==1 and c[0]["id"]=="p_mem" and c[0]["shop"]=="members", r)
r=chat("cards:show", cookie=MEMBER)
check("member: products sold in both shops go to the members' cart", (r.get("products") or [{}])[0].get("shop")=="members", r.get("products"))
r=chat("cards:inquire")
c=r.get("products") or []
check("'Inquire' priced items: View only, no Add to cart", len(c)==1 and c[0]["canAdd"] is False, c)
r=chat("cards:many", cookie=MEMBER)
ids=[x["id"] for x in (r.get("products") or [])]
check("at most 4 cards, no duplicates", len(ids)==len(set(ids)) and len(ids)<=4, ids)
r=chat("cards:mention")
check("names in the reply become cards even if the model forgot to ask", [x["id"] for x in (r.get("products") or [])]==["p_pub"], r)
r=chat("cards:none")
check("no products mentioned → no cards", not r.get("products"), r)
r=chat("cards:forbidden")
check("a redirected (off-limits) answer shows no cards", not r.get("products") and "support" in r["reply"].lower(), r)
r=chat("cards:show", cookie=ADMIN, mode="admin")
check("staff chat: no shopping cards", not r.get("products"), r.get("products"))
print(f"\n{sum(res)}/{len(res)} passed")
