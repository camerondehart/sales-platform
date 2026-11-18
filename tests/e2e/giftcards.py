# Gift cards: buying a card makes a normal pending order;
# the card is delivered only when payment is CONFIRMED by staff (not by the
# customer's "I've paid"); the buyer's bonus ($5 per $50); the recipient's
# account and email; claim by code; balance comes off checkout automatically;
# cancelling returns balance / voids unspent cards; the switch hides it all.
import json, urllib.request, os, re
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); T2=json.load(open("/tmp/harness/tokens18.json"))
ADMIN=f"gallery_admin={T['admin']}"; MIA=f"gallery_visitor={T['member']}"; ROB=f"gallery_visitor={T2['rob']}"; KIM=f"gallery_visitor={T2['kim']}"
res=[]
def check(n,c,d=""):
    c=bool(c); res.append(c); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:700]}"))
def req(path, body=None, cookie=ADMIN, method=None, raw=False):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json")
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            b=resp.read(); return resp.status, (b.decode() if raw else json.loads(b or b"{}"))
    except urllib.error.HTTPError as e:
        b=e.read()
        try: return e.code, (b.decode() if raw else json.loads(b or b"{}"))
        except Exception: return e.code, {}
def mail(): return json.loads(urllib.request.urlopen(GW+"/__mail").read())
def cards(): return json.load(open(D+"gift-cards.json")) if os.path.exists(D+"gift-cards.json") else []
def orders(): return json.load(open(D+"orders.json"))
def order(i): return [o for o in orders() if o["id"]==i][0]

# ---- page + API need an approved member
s,_=req("/api/gift-cards", cookie=None)
check("gift cards API: members only", s==401, s)
s,html=req("/gift-cards", cookie=MIA, raw=True)
check("gift cards page renders for a member, with the bonus line", s==200 and "Give a little Northwind" in html and "for yourself with every" in html, s)
s,html=req("/gallery", cookie=MIA, raw=True)
check("members' shop links to Gift cards", 'href="/gift-cards"' in html, s)

# ---- validation
s,r=req("/api/gift-cards", {"action":"buy","amount":5,"occasion":"birthday","toName":"Rob","toEmail":"rob@example.com"}, cookie=MIA)
check("amount below $10 refused", s==400, (s,r))
s,r=req("/api/gift-cards", {"action":"buy","amount":50,"occasion":"birthday","toName":"Rob","toEmail":"not-an-email"}, cookie=MIA)
check("recipient email required", s==400, (s,r))

# ---- buy a $100 birthday card for Rob
before=len(mail())
s,r=req("/api/gift-cards", {"action":"buy","amount":100,"occasion":"birthday","toName":"Rob","toEmail":"Rob@Example.com","fromName":"Mia","note":"Happy birthday! <b>x</b>"}, cookie=MIA)
oid=r.get("orderId")
check("buy: order saved, bonus $10 for $100", s==200 and oid and r.get("bonus")==10 and r.get("total")==100, (s,r))
o=order(oid)
check("gift card order: pending, $100, flagged, nothing to ship", o["status"]=="pending" and o["total"]==100 and o.get("giftCardOrder") is True and o["shippingCost"]==0, o)
c=[c for c in cards() if c["orderId"]==oid]
check("card saved as awaiting payment", len(c)==1 and c[0]["state"]=="awaiting" and c[0]["toEmail"]=="rob@example.com" and c[0]["bonus"]==10 and re.match(r"^GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}$", c[0]["code"]), c)
new=mail()[before:]
inv=[m for m in new if m["to"]=="mem@example.com"]
check("buyer gets the invoice (how to pay), not the card", len(inv)==1 and "how to pay" in inv[0]["subject"] and "Delivery (by email)" in inv[0]["html"] and "Local pickup" not in inv[0]["html"], [m["subject"] for m in new])
check("team is told it's a gift card", any(m["to"]=="team@example.com" and "gift card" in m["subject"].lower() for m in new), [m["subject"] for m in new])
check("recipient gets nothing before payment", not any(m["to"]=="rob@example.com" for m in new), new)
s,r=req("/api/gift-cards", cookie=ROB)
check("recipient's account: no card before payment", s==200 and r["balance"]==0 and r["cards"]==[], r)

# ---- customer's "I've paid" doesn't deliver
s,r=req("/api/orders/mark-paid", {"token":o["paymentToken"]}, cookie=None)
check("customer taps I've paid: order paid", s==200 and order(oid)["status"]=="paid", (s,r))
check("…but the card is still waiting", [c for c in cards() if c["orderId"]==oid][0]["state"]=="awaiting", cards())
team=[m for m in mail() if m["to"]=="team@example.com" and "marked paid" in m["subject"]]
check("team email says to confirm the payment to send the card", team and "gift card" in team[-1]["html"], [m["subject"] for m in mail()][-3:])

# ---- staff confirms (Completed) -> delivered + bonus + emails + completed
before=len(mail())
s,r=req("/api/admin/orders", {"id":oid,"status":"completed"}, method="PATCH")
check("staff completes: card delivered", s==200 and r.get("giftCardsDelivered")==2, (s,r))
cs=[c for c in cards() if c["orderId"]==oid]
gift=[c for c in cs if c["kind"]=="gift"][0]; bonus=[c for c in cs if c["kind"]=="bonus"]
check("card active, in Rob's account (matched by email)", gift["state"]=="active" and gift["ownerId"]=="u_rob" and gift["balance"]==100, gift)
check("buyer's $10 bonus credit in Mia's account", len(bonus)==1 and bonus[0]["amount"]==10 and bonus[0]["ownerId"]=="u_member" and bonus[0]["state"]=="active", bonus)
new=mail()[before:]
rm=[m for m in new if m["to"]=="rob@example.com"]
check("recipient emailed with the code and card link; note escaped", len(rm)==1 and gift["code"] in rm[0]["html"] and "/gift/"+gift["token"] in rm[0]["html"] and "&lt;b&gt;" in rm[0]["html"], [m["subject"] for m in new])
check("buyer told it's sent, with the bonus", any(m["to"]=="mem@example.com" and "on its way" in m["subject"] and "$10 bonus credit" in m["html"] for m in new), [m["subject"] for m in new])
s,r=req("/api/admin/orders", {"id":oid,"status":"completed"}, method="PATCH")
check("confirming again sends nothing twice", s==200 and not r.get("giftCardsDelivered") and len([c for c in cards() if c["orderId"]==oid])==2 and len([m for m in mail()[before:] if m["to"]=="rob@example.com"])==1, (s,r))

s,r=req("/api/gift-cards", cookie=ROB)
check("Rob's account shows the $100 card with note, no emails or token", r["balance"]==100 and len(r["cards"])==1 and r["cards"][0]["note"].startswith("Happy birthday") and "token" not in json.dumps(r) and "mem@example.com" not in json.dumps(r), r)
s,r=req("/api/gift-cards", cookie=MIA)
check("Mia: $10 bonus balance, and the card she sent shows Delivered", r["balance"]==10 and r["sent"][0]["state"]=="active", r)

s,html=req("/gift/"+gift["token"], cookie=None, raw=True)
check("card page opens from the email link", s==200 and gift["code"] in html and "gc-card" in html and "Request membership" in html, s)
s,_=req("/gift/"+"0"*48, cookie=None, raw=True)
check("unknown card link: not found", s==404, s)

# ---- checkout: balance comes off automatically
s,r=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"ship","address":{"addressLine1":"1 A St","city":"Springfield","state":"IL","postalCode":"62701"}}, cookie=ROB)
o2=order(r.get("orderId",""))
check("Rob's $40 + $10 shipping order: paid in full by gift card", s==200 and o2["giftCardApplied"]==50 and o2["total"]==0 and o2["status"]=="paid" and r.get("paidByGift") is True, (s,r))
g=[c for c in cards() if c["id"]==gift["id"]][0]
check("card balance now $50", g["balance"]==50, g)
s,r=req("/api/admin/orders", {"id":o2["id"],"status":"cancelled"}, method="PATCH")
g=[c for c in cards() if c["id"]==gift["id"]][0]
check("cancelling that order puts the $50 back", s==200 and g["balance"]==100, (s,r,g))
s,r=req("/api/admin/orders", {"id":o2["id"],"status":"paid"}, method="PATCH")
g=[c for c in cards() if c["id"]==gift["id"]][0]
check("setting it back from cancelled takes it again", s==200 and g["balance"]==50, (s,r,g))
s,r=req("/api/admin/orders", {"id":o2["id"],"status":"cancelled"}, method="PATCH")
check("…and cancelling again returns it again", [c for c in cards() if c["id"]==gift["id"]][0]["balance"]==100, cards())

s,r=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup"}, cookie=MIA)
o3=order(r.get("orderId",""))
check("Mia's $40 pickup: $10 bonus off, $30 to pay by invoice", s==200 and o3["giftCardApplied"]==10 and o3["total"]==30 and o3["status"]=="pending", (s,r))
b=[c for c in cards() if c["kind"]=="bonus"][0]
check("bonus spent", b["balance"]==0, b)

# ---- claim by code
s,r=req("/api/gift-cards", {"action":"buy","amount":25,"occasion":"just-because","toName":"Someone","toEmail":"elsewhere@example.com"}, cookie=MIA)
oid4=r["orderId"]
check("$25 card: no bonus (under $50)", r.get("bonus")==0, r)
c4=[c for c in cards() if c["orderId"]==oid4][0]
s,r=req("/api/gift-cards", {"action":"claim","code":c4["code"]}, cookie=KIM)
check("a card waiting for payment can't be claimed", s==400, (s,r))
req("/api/admin/orders", {"id":oid4,"status":"paid"}, method="PATCH")
c4=[c for c in cards() if c["orderId"]==oid4][0]
check("staff Paid also delivers; nobody holds it yet (email isn't a member)", c4["state"]=="active" and not c4.get("ownerId") and order(oid4)["status"]=="completed", (c4, order(oid4)["status"]))
check("no bonus card for a $25 card", len([c for c in cards() if c["orderId"]==oid4])==1, cards())
s,r=req("/api/gift-cards", {"action":"claim","code":c4["code"].lower().replace("-","")}, cookie=KIM)
check("Kim adds it by code (any case, no dashes)", s==200 and r["card"]["balance"]==25, (s,r))
s,r=req("/api/gift-cards", {"action":"claim","code":c4["code"]}, cookie=ROB)
check("someone else can't take a claimed card", s==400, (s,r))

# ---- cancelling an unspent gift card order voids the card and its bonus
s,r=req("/api/gift-cards", {"action":"buy","amount":50,"occasion":"holidays","toName":"Kim","toEmail":"kim@example.com"}, cookie=MIA)
oid5=r["orderId"]
req("/api/admin/orders", {"id":oid5,"status":"paid"}, method="PATCH")
cs=[c for c in cards() if c["orderId"]==oid5]
check("$50 card + $5 bonus delivered", sorted(c["amount"] for c in cs)==[5,50] and all(c["state"]=="active" for c in cs), cs)
s,r=req("/api/admin/orders", {"id":oid5,"status":"cancelled"}, method="PATCH")
cs=[c for c in cards() if c["orderId"]==oid5]
check("cancelled: card and bonus void", s==200 and all(c["state"]=="void" for c in cs), cs)
s,r=req("/api/gift-cards", cookie=KIM)
check("a void card doesn't count toward balance", r["balance"]==25, r)

# ---- staff panel + void
s,r=req("/api/admin/gift-cards", cookie=MIA)
check("staff list: staff only", s==401, s)
s,r=req("/api/admin/gift-cards")
check("staff list: every card, no tokens", s==200 and len(r["cards"])==len(cards()) and "token" not in json.dumps(r), s)
s,r=req("/api/admin/gift-cards", {"action":"void","id":c4["id"]})
check("staff can void a card", s==200 and [c for c in cards() if c["id"]==c4["id"]][0]["state"]=="void", (s,r))
s,r=req("/api/admin/settings", {"partial":True,"giftBonusPer":10,"giftBonusStep":100})
s,r=req("/api/admin/settings")
check("bonus rule saved from Settings", r["settings"].get("giftBonusPer")==10 and r["settings"].get("giftBonusStep")==100, r)
s,r=req("/api/gift-cards", {"action":"buy","amount":150,"occasion":"thank-you","toName":"A","toEmail":"a@example.com"}, cookie=MIA)
check("new rule used: $150 -> $10", r.get("bonus")==10, r)
req("/api/admin/settings", {"partial":True,"giftBonusPer":5,"giftBonusStep":50})
s,r=req("/api/gift-cards", {"action":"buy","amount":500,"occasion":"birthday","toName":"B","toEmail":"b@example.com"}, cookie=MIA)
check("bonus tops out at $20 per card ($500 card)", r.get("bonus")==20, r)

# ---- switch off: page and checkout hide it
req("/api/admin/flags", {"key":"gift_cards","on":False})
s,r=req("/api/gift-cards", {"action":"buy","amount":50,"occasion":"birthday","toName":"R","toEmail":"r@example.com"}, cookie=MIA)
check("switch off: can't buy", s==403, (s,r))
s,html=req("/gallery", cookie=MIA, raw=True)
check("switch off: no Gift cards link", 'href="/gift-cards"' not in html, s)
s,r=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup"}, cookie=ROB)
check("switch off: balance not used at checkout", s==200 and not order(r["orderId"]).get("giftCardApplied"), r)
req("/api/admin/flags", {"key":"gift_cards","on":True})

s,html=req("/terms", cookie=None, raw=True)
check("terms cover gift cards", "Gift cards." in html and "expire" in html, s)
s,html=req("/privacy", cookie=None, raw=True)
check("privacy covers gift cards", "recipient&#x27;s name and email" in html or "recipient's name and email" in html, s)

print(f"{sum(res)}/{len(res)} passed")
