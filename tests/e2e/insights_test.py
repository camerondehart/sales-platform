import json, urllib.request, time
from collections import defaultdict
BASE="http://127.0.0.1:3470"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:600]}"))
def chat(text, cookie=ADMIN, mode="admin"):
    r=urllib.request.Request(BASE+"/api/assistant/chat", data=json.dumps({"mode":mode,"messages":[{"role":"user","content":text}]}).encode(), method="POST")
    r.add_header("content-type","application/json")
    if cookie: r.add_header("cookie", cookie)
    with urllib.request.urlopen(r, timeout=90) as resp: return json.loads(resp.read())
def tool(text):
    rep=chat(text)["reply"]
    assert rep.startswith("FULL::"), rep[:300]
    body=rep[6:]; return json.loads(body), len(body)
orders=json.load(open(D+"orders.json")); users=json.load(open(D+"users.json"))
now=int(time.time()*1000); DAY=86400000
import datetime
from zoneinfo import ZoneInfo
_LA=ZoneInfo("America/Los_Angeles")
def start(n):
    """'Last n days' = today + the n-1 full days before, midnight Pacific (lib/periods.ts)."""
    d=datetime.datetime.fromtimestamp(now/1000,_LA).date()-datetime.timedelta(days=n-1)
    return int(datetime.datetime(d.year,d.month,d.day,tzinfo=_LA).timestamp()*1000)
paid=[o for o in orders if o["status"] in ("paid","completed","shipped","picked-up")]
at=lambda o:o.get("paidAt") or o["createdAt"]
m=lambda n:f"${n:.2f}"

# ---- last 30 days, checked independently
t0=time.time(); r,size=tool("act:insights"); ms=(time.time()-t0)*1000
cur=[o for o in paid if at(o)>=start(30)]; prev=[o for o in paid if start(60)<=at(o)<start(30)]
check("30d: order count", r["totals"]["orders"]==len(cur), (r["totals"], len(cur)))
check("30d: revenue", r["totals"]["revenue"]==m(sum(o["total"] for o in cur)), (r["totals"]["revenue"], m(sum(o["total"] for o in cur))))
pc=round((sum(o["total"] for o in cur)-sum(o["total"] for o in prev))/sum(o["total"] for o in prev)*100)
check("30d: change vs previous 30 days", r["totals"]["revenue_vs_prev"]==f"{pc}%", (r["totals"]["revenue_vs_prev"], pc))
spend=defaultdict(float); cnt=defaultdict(int)
for o in cur: spend[o["userEmail"]]+=o["total"]; cnt[o["userEmail"]]+=1
topE=max(spend,key=spend.get)
check("30d: top spender is Ann", r["top_customers_by_spend"][0]["email"]==topE=="ann@example.com" and r["top_customers_by_spend"][0]["spend"]==m(spend[topE]), r["top_customers_by_spend"][:2])
check("30d: most orders", r["top_customers_by_orders"][0]["orders"]==max(cnt.values()), (r["top_customers_by_orders"][:2], max(cnt.values())))
units=defaultdict(int)
for o in cur:
    for it in o["items"]: units[it["productName"]]+=it["quantity"]
tp=max(units,key=units.get)
check("30d: best seller by units", r["top_products_by_units"][0]["name"]==tp and r["top_products_by_units"][0]["units"]==units[tp], (r["top_products_by_units"][:2], tp, units[tp]))
check("30d: never-sold product flagged", "Dusty Old Salve" in (r["not_sold_this_period"] or []), r["not_sold_this_period"])
life=defaultdict(lambda:[0,0.0,0])
for o in paid:
    L=life[o["userEmail"]]; L[0]+=1; L[1]+=o["total"]; L[2]=max(L[2],at(o))
exp=[e for e,(n,sp,last) in sorted(life.items(), key=lambda kv:-kv[1][1]) if n>=2 and now-last>60*DAY][:10]
check("30d: lapsed regulars = 2+ orders, none in 60 days, biggest spenders first", [x["email"] for x in r["lapsed_regulars"]]==exp, ([x["email"] for x in r["lapsed_regulars"]], exp))
check("30d: Bob (4 orders, last 120 days ago) qualifies as lapsed", "bob@example.com" in [e for e,(n,sp,last) in life.items() if n>=2 and now-last>60*DAY])
check("30d: new + returning = customers", r["totals"]["new_customers"]+r["totals"]["returning_customers"]==r["totals"]["customers"]==len(spend), r["totals"])
ch=r["channels"]; 
check("30d: channel split adds up", ch["member_shop"]["orders"]+ch["public_shop"]["orders"]==len(cur) and ch["shipped"]["orders"]+ch["pickup"]["orders"]==len(cur), ch)
check("30d: discount code reported", any(x.startswith("FALL15:") for x in r["discount_codes_used"]), r["discount_codes_used"])
pend=[o for o in orders if o["status"]=="pending" and o["createdAt"]>=start(30)]
check("30d: unpaid orders not counted as sales, reported separately", r["not_yet_paid"]["orders"]==len(pend), (r["not_yet_paid"], len(pend)))
check("30d: member flag matches approved accounts", all(c["member"]==any(u["email"]==c["email"] and u["status"]=="approved" for u in users) for c in r["top_customers_by_spend"]))
check(f"30d: fits in the tool budget ({size} chars) and fast ({ms:.0f} ms round trip)", size<12000 and ms<5000, size)

# ---- all time, max rows
r,size=tool("act:insights-all")
check("all time: every paid order counted", r["totals"]["orders"]==len(paid), (r["totals"]["orders"], len(paid)))
check(f"all time, 25 rows: still under 12,000 chars ({size})", size<12000, size)
check("all time: lifetime top spender list", len(r["lifetime_top_spenders"])==10, len(r["lifetime_top_spenders"]))

# ---- product focus
r,_=tool("act:insights-product")
lion=[o for o in paid if at(o)>=start(90) and any(i["productId"]=="p_lion" for i in o["items"])]
check("product focus: only orders with Lion's Mane", r["totals"]["orders"]==len(lion) and r["only_orders_containing"]==["Lion's Mane Tincture"], (r["totals"]["orders"], len(lion)))

# ---- customer profile
r,_=tool("act:insights-customer")
c=r["customer"]
check("customer: Ann's lifetime", c["email"]=="ann@example.com" and c["lifetime_orders"]==5 and c["lifetime_spend"]==m(5*(225+10)) and c["favourite_products"][0]=="Cordyceps Capsules ×25", c)
r,_=tool("act:insights-ambiguous")
check("customer: ambiguous asks which", "matches" in r and len(r["matches"])>1, r)

# ---- date range
r,_=tool("act:insights-range")
check("range: labelled", r["period"].startswith("2026-09-01 to 2026-09-15"), r["period"])
r,_=tool("act:insights-bad")
check("range: bad date explained", "error" in r and "2026-09-01" in r["error"], r)
r,_=tool("act:insights-noprod")
check("product: unknown product explained", "error" in r, r)

# ---- not available to customers
rep=chat("act:insights", cookie=None, mode="site")["reply"]
check("customers can't run it", "not available" in rep, rep[:200])
print(f"\n{sum(res)}/{len(res)} passed")
