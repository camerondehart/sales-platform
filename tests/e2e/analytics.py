import json, urllib.request, glob, time
BASE="http://127.0.0.1:3470"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:400]}"))
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile Safari"
def t(e, p=None, ua=UA, ip="10.5.0.1", raw=None):
    body=raw if raw is not None else json.dumps({"e":e,"p":p or {}}).encode()
    r=urllib.request.Request(BASE+"/api/t", data=body, method="POST")
    r.add_header("content-type","application/json"); r.add_header("user-agent",ua); r.add_header("x-forwarded-for",ip); r.add_header("x-vercel-ip-country","US")
    with urllib.request.urlopen(r, timeout=30) as resp: return resp.status
def get(path, cookie=ADMIN):
    r=urllib.request.Request(BASE+path); r.add_header("cookie",cookie) if cookie else None
    class NR(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k): return None
    try:
        with urllib.request.build_opener(NR).open(r, timeout=60) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

# a few sessions
check("event accepted (204, no body)", t("visit", {"path":"/retail","ref":"instagram.com","device":"phone","campaign":"fall-2026","first":"1"})==204)
t("visit", {"path":"/","ref":"","device":"desktop"})
t("visit", {"path":"/","ref":"google.com","device":"phone"})
for _ in range(3): t("page", {"path":"/retail"})
t("page", {"path":"/pay/abcdef123456"})
t("product_view", {"id":"p_pub","first":"1"}); t("product_view", {"id":"p_pub"}); t("product_view", {"id":"p_mem","first":"1"})
t("add_to_cart", {"id":"p_pub","first":"1"})
t("checkout_open", {"shop":"public","first":"1"})
t("order_placed", {"value":49.99,"shop":"public","campaign":"fall-2026","first":"1"})
# noise that must be ignored
t("visit", {"path":"/"}, ua="Googlebot/2.1 (+http://www.google.com/bot.html)")
t("hack_the_planet", {"x":1})
t("visit", raw=b"{not json")
t("visit", raw=json.dumps({"e":"visit","p":{"path":"/"*3000}}).encode())
# QR scan (server-side)
get("/p/p_pub", cookie=None)

s,d=get("/api/admin/analytics?days=7")
check("dashboard builds", s==200 and "kpis" in d, (s,d))
check("visits counted, bots and junk ignored", d["kpis"]["visitors"]["value"]==3, d["kpis"]["visitors"])
f={x["step"]:x["count"] for x in d["funnel"]}
check("funnel counts sessions per step", f=={"visit":3,"product_view":2,"add_to_cart":1,"checkout_open":1,"order_placed":1}, f)
refs={r["key"]:r["value"] for r in d["sources"]["referrers"]}
check("referrers incl. direct", refs.get("instagram.com")==1 and refs.get("google.com")==1 and refs.get("direct")==1, refs)
check("devices", d["sources"]["devices"]=={"phone":2,"tablet":0,"desktop":1}, d["sources"]["devices"])
pages={p["key"]:p["value"] for p in d["sources"]["pages"]}
check("page views, payment links collapsed (no tokens stored)", pages.get("/retail")==3 and pages.get("/pay/…")==1 and not any("abcdef" in k for k in pages), pages)
pv={p["id"]:p for p in d["products"]}
check("per-product views & carts", pv["p_pub"]["views"]==2 and pv["p_pub"]["adds"]==1 and pv["p_mem"]["views"]==1, pv.get("p_pub"))
camp={c["id"]:c for c in d["sources"]["campaigns"]}
check("campaign visits, orders and sales attributed", camp["fall-2026"]["visits"]==1 and camp["fall-2026"]["orders"]==1 and camp["fall-2026"]["revenue"]==49.99, camp)
check("QR scan counted", d["sources"]["qr"]["scans"]==1 and d["sources"]["qr"]["byProduct"][0]["key"]=="p_pub", d["sources"]["qr"])
check("sales numbers come from real paid orders", d["kpis"]["orders"]["value"]>=0 and isinstance(d["daily"], list) and len(d["daily"])==7)
files=glob.glob(D+"traffic-*.json"); blob=open(files[0]).read() if files else ""
check("stored as daily counters only — no IPs, no user agents", files and "10.5.0.1" not in blob and "iPhone" not in blob and '"e:visit": 3' in blob.replace('"e:visit":3','"e:visit": 3'), blob[:300])

for days in (30,90,365):
    s,dd=get(f"/api/admin/analytics?days={days}")
    check(f"{days}-day view works", s==200 and dd["range"]["days"]==days and len(dd["daily"]) in (days, days-1, days+1), (s, dd.get("range")))
s,_=get("/api/admin/analytics", cookie=MEMBER)
check("dashboard is admin only", s==401, s)


# ---- one definition of "last N days" everywhere (Pacific calendar days)
import datetime
from zoneinfo import ZoneInfo
LA=ZoneInfo("America/Los_Angeles"); now=int(time.time()*1000)
today=datetime.datetime.fromtimestamp(now/1000,LA).date()
def mid(d): return int(datetime.datetime(d.year,d.month,d.day,tzinfo=LA).timestamp()*1000)
start7=mid(today-datetime.timedelta(days=6)); yday=mid(today-datetime.timedelta(days=1))
def od(i,email,total,paidAt,status="paid"):
    return {"id":f"ord_edge{i}","userId":"guest_"+email,"userName":email.split("@")[0].title(),"userEmail":email,"items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":f"${total}","quantity":1}],
            "shippingMethod":"pickup","shippingCost":0,"subtotal":total,"total":total,"isInquiry":False,"status":status,"paymentToken":f"te{i}","createdAt":paidAt-1000,"paidAt":paidAt,"source":"retail"}
orders=json.load(open(D+"orders.json"))
late=mid(today-datetime.timedelta(days=2))+23*3600_000  # 11pm Pacific = next day in UTC
orders+=[od(9,"late@example.com",77,late), od(1,"edge@example.com",100,start7+60_000), od(2,"edge@example.com",40,start7-60_000), od(3,"edge@example.com",25,now-60_000),
         od(4,"yday@example.com",60,yday+12*3600_000), od(5,"yday@example.com",999,now-60_000,status="pending")]
json.dump(orders,open(D+"orders.json","w"))
paid=[o for o in orders if o["status"] in ("paid","completed","shipped","picked-up")]
at=lambda o:o.get("paidAt") or o["createdAt"]
exp7=round(sum(o["total"] for o in paid if at(o)>=start7),2)
s,d=get("/api/admin/analytics?days=7")
check("7 days = today + 6 full days, Pacific (order 1 min after the start counts, 1 min before doesn't)", abs(d["kpis"]["revenue"]["value"]-exp7)<0.005, (d["kpis"]["revenue"]["value"], exp7))
check("headline total = sum of the day-by-day chart", abs(sum(x["revenue"] for x in d["daily"])-d["kpis"]["revenue"]["value"])<0.01, (sum(x["revenue"] for x in d["daily"]), d["kpis"]["revenue"]["value"]))
check("chart starts on the first day of the period", d["daily"][0]["day"]==str(today-datetime.timedelta(days=6)) and d["daily"][-1]["day"]==str(today), (d["daily"][0]["day"], d["daily"][-1]["day"]))
edge=[c for c in d["customers"]["top"] if c["email"]=="edge@example.com"]
check("top customers use the same period", edge and edge[0]["orders"]==2 and edge[0]["spend"]==125, edge)
urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4555/__reset"))
r=urllib.request.Request(BASE+"/api/admin/export-email", data=b"{}", method="POST"); r.add_header("content-type","application/json"); r.add_header("cookie",ADMIN)
try: urllib.request.urlopen(r, timeout=60).read()
except urllib.error.HTTPError as e: pass
mails=json.loads(urllib.request.urlopen("http://127.0.0.1:4555/__mail").read())
rep=[m for m in mails if "nightly report" in m.get("subject","")]
expY=round(sum(o["total"] for o in paid if yday<=at(o)<mid(today)),2)
check("nightly report: 'Yesterday' is the full previous Pacific day", rep and f"${expY:.2f} yesterday" in rep[-1]["subject"] and ">Yesterday<" in rep[-1]["html"], rep and rep[-1]["subject"])
check("nightly report: 'Last 7 days' matches the Analytics tab", rep and f"${exp7:.2f} last 7 days" in rep[-1]["subject"], rep and rep[-1]["subject"])

# per-IP cap
for i in range(245): t("page", {"path":"/x"}, ip="10.5.0.99")
s,d=get("/api/admin/analytics?days=7")
pages={p["key"]:p["value"] for p in d["sources"]["pages"]}
check("one IP can't flood the counts (240/min cap)", pages.get("/x")==240, pages.get("/x"))

# switch off
r=urllib.request.Request(BASE+"/api/admin/flags", data=json.dumps({"key":"analytics_v2","on":False}).encode(), method="POST"); r.add_header("content-type","application/json"); r.add_header("cookie",ADMIN); urllib.request.urlopen(r)
t("visit", {"path":"/","device":"phone"}, ip="10.5.0.7")
s,d=get("/api/admin/analytics?days=7")
check("switch off: nothing more is counted", d["kpis"]["visitors"]["value"]==3, d["kpis"]["visitors"])
r=urllib.request.Request(BASE+"/api/admin/flags", data=json.dumps({"key":"analytics_v2","on":True}).encode(), method="POST"); r.add_header("content-type","application/json"); r.add_header("cookie",ADMIN); urllib.request.urlopen(r)
# ---- spreadsheets use Pacific dates too
r=urllib.request.Request(BASE+"/api/admin/revenue/export"); r.add_header("cookie",ADMIN)
csvt=urllib.request.urlopen(r).read().decode()
lday=str(today-datetime.timedelta(days=2))
check("revenue spreadsheet: an 11pm Pacific order is on its Pacific date, not the next UTC day", f'"late@example.com","1","77.00","77.00","{lday}","{lday}"' in csvt, [l for l in csvt.splitlines() if "late@" in l])
check("revenue spreadsheet: says its dates are Pacific", "Pacific" in csvt.splitlines()[1] and "Pacific time" in csvt, csvt.splitlines()[:4])
r=urllib.request.Request(BASE+"/api/admin/orders/export"); r.add_header("cookie",ADMIN)
ot=urllib.request.urlopen(r).read().decode()
row=[l for l in ot.splitlines() if "late@example.com" in l]
check("orders spreadsheet: Pacific times, labelled", "Date (Pacific)" in ot.splitlines()[0] and row and f"{lday} 23:00" in row[0], (ot.splitlines()[0], row))
# ---- event confirmation email shows the Pacific time
ev=json.load(open(D+"events.json"))[0]
t=datetime.datetime.fromtimestamp(ev["date"]/1000, LA)
hm=f"{t.hour%12 or 12}:{t.minute:02d} {'AM' if t.hour<12 else 'PM'}"
rq=urllib.request.Request(BASE+"/api/events/register", data=json.dumps({"eventId":ev["id"],"name":"Tz Test","email":"tz@example.com"}).encode(), method="POST"); rq.add_header("content-type","application/json")
urllib.request.urlopen(rq).read()
mails=json.loads(urllib.request.urlopen("http://127.0.0.1:4555/__mail").read())
em=[m for m in mails if m.get("to") in ("tz@example.com",["tz@example.com"])]
check("event sign-up email shows the event's Pacific time", em and hm in em[-1]["html"], (hm, em and em[-1]["html"][:400]))
print(f"\n{sum(res)}/{len(res)} passed")
