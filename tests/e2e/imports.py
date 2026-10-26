# Shopify import, set-password links & invites, campaign groups. Fake people only.
import json, urllib.request, urllib.parse, time, os, re, csv, io
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"
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
def users(): return {u["email"]:u for u in json.load(open(D+"users.json"))}
def subs(): return {s["email"]:s for s in (json.load(open(D+"subscribers.json")) if os.path.exists(D+"subscribers.json") else [])}

H=["Customer ID","First Name","Last Name","Email","Accepts Email Marketing","Default Address Company","Default Address Address1","Default Address Address2","Default Address City","Default Address Province Code","Default Address Country Code","Default Address Zip","Default Address Phone","Phone","Accepts SMS Marketing","Total Spent","Total Orders","Note","Tax Exempt","Tags","Accepts WhatsApp Marketing",
   "Are you 21 or older? (customer.metafields.customer_fields.are_you_21_or_older_1)","Have you used our products before? (customer.metafields.customer_fields.have_you_used_four_peaks_m)","Would you consider yourself a beginner, novice, or expert when it comes to mushrooms? (customer.metafields.customer_fields.would_you_consider_yoursel)","Would you like to schedule a phone consultation to learn more about FPM and the best products for you? (customer.metafields.customer_fields.would_you_like_to_schedule)","Seguno last open date (customer.metafields.seguno.last_open_date)"]
def row(cid,first,last,email,mkt,addr="",city="",st="",zip_="",phone="",spent="0.00",orders="0",note="",tags="",o21="Yes",used="Yes",exp="Novice",consult="No"):
    return ["'"+cid,first,last,email,mkt,"",addr,"",city,st,"US" if addr else "",zip_,"",phone,"no",spent,orders,note,"no",tags,"no",o21,used,exp,consult,""]
rows=[
 row("1","Ada","Lovelace","ada@example.com","yes","1 Main St","Portland","OR","97201","'+15035550100","536.77","4","Loves the tea","newsletter","Yes","Yes","Expert","Yes"),
 row("2","Bo","Brown","bo@example.com","no","","","","","","0.00","0","","","Yes","No","Beginner","No"),
 row("3","Cy","Young","cy@example.com","yes", o21="", used="", exp="", consult=""),
 row("4","Mia","Imposter","MEM@example.com","yes","9 Fake Rd","Nowhere","ZZ","00000"),          # already a member — must not change
 row("5","Kid","Young","kid@example.com","yes", o21="No"),                                     # under 21 — skipped
 row("6","No","Email","","yes"),                                                              # no email — skipped
 row("7","Ada","Again","ada@example.com","yes"),                                               # duplicate row — ignored
 row("8","Dee","Dee","dee@example.com","no","2 Oak Ave","Seattle","WA","98101", spent="120.00", orders="2"),
]
buf=io.StringIO(); w=csv.writer(buf); w.writerow(H); w.writerows(rows); CSV=buf.getvalue()

before_users=users(); before_mem=before_users.get("mem@example.com"); before_subs=subs()
s,r,_=req("/api/admin/users/import-shopify",{"csv":CSV,"dryRun":True})
check("import preview: counts right, nothing saved", s==200 and r["newMembers"]==4 and r["alreadyMembers"]==1 and r["under21Skipped"]==1 and r["noEmail"]==1 and r["duplicatesInFile"]==1 and r["subscribed"]==2 and r["optedOut"]==2 and users().keys()==before_users.keys(), (s,r))
s,r,_=req("/api/admin/users/import-shopify",{"csv":CSV,"dryRun":True},cookie=None)
check("import: staff only", s==401, s)
s,r,_=req("/api/admin/users/import-shopify",{"csv":"email,name\nx@example.com,X","dryRun":True})
check("import: a non-Shopify file is refused with a clear message", s==400 and "Shopify" in r.get("error",""), (s,r))
s,r,_=req("/api/admin/users/import-shopify",{"csv":CSV,"dryRun":False})
U=users(); S=subs()
check("import: 4 new approved members", s==200 and r["newMembers"]==4 and all(U.get(e,{}).get("status")=="approved" for e in ["ada@example.com","bo@example.com","cy@example.com","dee@example.com"]), (s,r))
a=U["ada@example.com"]
check("import: address, phone, note, used-before, history and experience come across", a["name"]=="Ada Lovelace" and a["addressLine1"]=="1 Main St" and a["city"]=="Portland" and a["state"]=="OR" and a["postalCode"]=="97201" and a["phone"]=="+15035550100" and a["message"]=="Loves the tea" and a["priorCustomer"] is True and a["ageVerified"] is True and a["shopify"]["totalOrders"]==4 and a["shopify"]["totalSpent"]==536.77 and a["shopify"]["experience"]=="Expert" and a["shopify"]["wantsConsultation"] is True and a["importedFrom"]=="shopify" and a["needsPassword"] is True, a)
check("import: unanswered 21+ isn't recorded as verified", U["cy@example.com"].get("ageVerified") is not True, U["cy@example.com"])
check("import: existing member untouched (name, address, status)", U["mem@example.com"]==before_mem, (U["mem@example.com"], before_mem))
check("import: under-21 and no-email rows skipped", "kid@example.com" not in U, list(U)[:5])
check("import: marketing yes → subscribed, no → opted out (account emails only)", S["ada@example.com"].get("unsubscribedAt") is None and S["cy@example.com"].get("unsubscribedAt") is None and S["bo@example.com"].get("unsubscribedAt") and S["dee@example.com"].get("unsubscribedAt") and S["ada@example.com"]["source"]=="shopify", {k:S[k] for k in ["ada@example.com","bo@example.com"]})
check("import: existing member's mailing-list status unchanged", S.get("mem@example.com")==before_subs.get("mem@example.com"), (S.get("mem@example.com"), before_subs.get("mem@example.com")))
check("import: no emails sent by the import", not any(m.get("subject","").startswith("Your Northwind account") for m in mail()), [m.get("subject") for m in mail()][-5:])
s,r,_=req("/api/admin/users/import-shopify",{"csv":CSV,"dryRun":False})
check("import: running it again adds nobody", s==200 and r["newMembers"]==0 and r["alreadyMembers"]==5 and len(users())==len(U), (s,r))
s,r,_=req("/api/admin/audit?limit=5") if False else (200,{},None)
aud=open(D+"audit.jsonl").read() if os.path.exists(D+"audit.jsonl") else ""
check("import: the file itself never lands in the Activity log", "Loves the tea" not in aud and "1 Main St" not in aud, "found customer data in audit")

# ---------- invites
s,st,_=req("/api/admin/invites")
check("invites: stats show 4 imported, 4 waiting, 4 never invited", s==200 and st["imported"]==4 and st["waiting"]>=4 and st["neverInvited"]>=4, st)
n=len(mail())
s,r,_=req("/api/admin/invites",{"action":"test"})
tm=mail()[n:]
check("invites: test goes to the team inbox only, with a preview link", s==200 and len(tm)==1 and tm[0]["to"]=="team@example.com" and "/welcome?t=preview" in tm[0]["html"], (s,r,[m.get("to") for m in tm]))
n=len(mail())
s,r,_=req("/api/admin/invites",{"action":"one","userId":U["ada@example.com"]["id"]})
m1=[m for m in mail()[n:] if m.get("to")=="ada@example.com"]
tok=re.search(r"/welcome\?t=([A-Za-z0-9_.\-]+)", m1[0]["html"]).group(1) if m1 else ""
check("invites: one member's link sent, they're marked invited", s==200 and tok and users()["ada@example.com"].get("inviteCount")==1, (s,r))
s,page,_=req("/welcome?t="+tok, cookie=None, raw=True)
check("welcome page: greets them by name with the password form", s==200 and re.search(r"Welcome,\s*(<!-- -->)?\s*Ada", page) and "new-password" in page, re.findall(r"Welcome[^<]{0,40}", page))
s,page,_=req("/welcome?t=garbage", cookie=None, raw=True)
check("welcome page: a bad link explains and offers a fresh one", s==200 and "isn" in page and "Email me a link" in page, page[:300])
s,r,_=req("/api/set-password",{"t":tok,"password":"short"}, cookie=None, headers={"x-forwarded-for":"7.1.1.1"})
check("set password: too short refused", s==400, (s,r))
s,r,h=req("/api/set-password",{"t":tok,"password":"a-good-long-password"}, cookie=None, headers={"x-forwarded-for":"7.1.1.1"})
check("set password: works and signs them in", s==200 and "gallery_visitor=" in (h.get("set-cookie") or ""), (s,r))
check("set password: no longer flagged as needing one", not users()["ada@example.com"].get("needsPassword"), users()["ada@example.com"])
s,r,_=req("/api/set-password",{"t":tok,"password":"another-long-password"}, cookie=None, headers={"x-forwarded-for":"7.1.1.1"})
check("set password: the link only works once", s==400 and r.get("reason")=="used", (s,r))
s,r,_=req("/api/login",{"role":"visitor","email":"ada@example.com","password":"a-good-long-password"}, cookie=None, headers={"x-forwarded-for":"7.1.1.2"})
check("sign in with the new password", s==200 and r.get("ok"), (s,r))
n=len(mail())
s,r,_=req("/api/set-password/link",{"email":"nobody-here@example.com"}, cookie=None, headers={"x-forwarded-for":"7.1.1.3"})
s2,r2,_=req("/api/set-password/link",{"email":"cy@example.com"}, cookie=None, headers={"x-forwarded-for":"7.1.1.3"})
sent=[m for m in mail()[n:] if m.get("to")=="cy@example.com"]
check("'Email me a link': same answer either way, link sent only to a real member", s==200 and s2==200 and r["message"]==r2["message"] and len(sent)==1 and not any(m.get("to")=="nobody-here@example.com" for m in mail()[n:]), (r,r2))
s,r,_=req("/api/admin/invites",{"action":"start","mode":"never_invited"})
check("invites: a run starts for everyone not yet invited (Ada and Cy already were)", s==200 and r["total"]==2, (s,r))
s,r2,_=req("/api/admin/invites",{"action":"start","mode":"never_invited"})
check("invites: only one run at a time", s==400, (s,r2))
if r.get("first",{}).get("sent")==2:
    # In sending hours the first batch goes straight out, so the (tiny) run is already finished.
    s,st0,_=req("/api/admin/invites")
    check("invites: started in sending hours → first batch out straight away", st0["job"]["status"]=="done" and st0["job"]["sent"]==2, st0)
    s3,r3,_=req("/api/admin/invites",{"action":"pause"})
    check("invites: nothing to pause once finished", s3==400, (s3,r3))
else:
    s,r3,_=req("/api/admin/invites",{"action":"pause"}); s4,r4,_=req("/api/admin/invites",{"action":"resume"})
    check("invites: pause and resume", s==200 and s4==200 and r4["stats"]["job"]["status"] in ("sending","done"), (r3,r4))
req("/api/cron/tick", cookie=ADMIN)
s,st,_=req("/api/admin/invites")
import datetime
from zoneinfo import ZoneInfo
hr=datetime.datetime.now(ZoneInfo("America/Los_Angeles")).hour
if 9<=hr<18:
    check("invites: run finishes in sending hours, skipping nobody who still needs a link", st["job"]["status"]=="done" and st["job"]["sent"]==2 and st["neverInvited"]==0, st)
else:
    check("invites: outside 9–6 Pacific the run waits", st["job"]["status"]=="sending" and st["job"]["sent"]==0, st)
    req("/api/admin/invites",{"action":"cancel"})

# ---------- campaign groups
SA=subs(); UA=users()
members={e for e,u in UA.items() if u["status"]=="approved"}
active={e for e,s in SA.items() if not s.get("unsubscribedAt")}
optout={e for e,s in SA.items() if s.get("unsubscribedAt")}
ms=len(active&members); ls=len(active-members); mn=len({e for e in members if e not in SA})
def send(groups):
    n=len(mail()); s,r,_=req("/api/admin/campaigns",{"subject":"G","body":"Hi","audience":"groups","groups":groups}); return s,r,[m for m in mail()[n:] if m.get("batch")]
s,r,b=send(["mn"])
check("groups: 'Non-subscribed members' = members not on the list and never opted out", s==200 and r["total"]==mn and not any(m["to"] in optout for m in b), (r,mn))
s,r,b=send(["ms","ls"])
check("groups: members subscribed + mailing list (not member) = everyone on the list", s==200 and r["total"]==ms+ls==len(active), (r,ms,ls))
s,r,_=req("/api/admin/campaigns",{"subject":"G","body":"Hi","audience":"groups","groups":[]})
check("groups: none picked is refused", s==400, (s,r))
check("groups: opted-out imported members never get campaigns", "bo@example.com" in optout and "dee@example.com" in optout, optout)

print(f"\n{sum(res)}/{len(res)} passed")
