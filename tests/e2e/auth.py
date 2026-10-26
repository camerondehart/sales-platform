import json, urllib.request, time, os, re
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:400]}"))
def req(path, body=None, cookie=ADMIN, method=None, ip="10.9.0.1"):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json"); r.add_header("x-forwarded-for", ip)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            ck=[h for h in resp.headers.get_all("set-cookie") or []]
            txt=resp.read()
            try: j=json.loads(txt or b"{}")
            except Exception: j={"_html":txt.decode()[:3000]}
            return resp.status, j, ck
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}"), []
        except Exception: return e.code, {}, []
def mail():
    with urllib.request.urlopen(GW+"/__mail") as r: return json.loads(r.read())
def cookie_from(ck, name):
    for c in ck:
        if c.startswith(name+"="): return c.split(";")[0]
def codes_file(): 
    try: return json.load(open(D+"login-codes.json"))
    except Exception: return []
def reset_codes():
    if os.path.exists(D+"login-codes.json"): os.remove(D+"login-codes.json")
def last_code(to):
    for m in reversed(mail()):
        if json.dumps(m.get("to")).find(to)>=0 and "sign-in code" in m.get("subject",""):
            return re.match(r"(\d{6})", m["subject"]).group(1)

# ---------------- member email codes
s,r,_=req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None)
check("code login: off by default (404)", s==404, s)
s,r,_=req("/", cookie=None)
check("sign-in form: no code option while off", "Email me a code" not in r.get("_html","") , "")
req("/api/admin/flags", {"key":"email_code_login","on":True})
s,r,_=req("/", cookie=None)
n=len(mail())
s,r,_=req("/api/login/code", {"action":"send","email":"MEM@example.com "}, cookie=None)
code=last_code("mem@example.com")
check("code login: approved member gets a 6-digit code", s==200 and r.get("ok") and code and len(mail())==n+1, (s,r))
check("code login: code isn't stored in plain text", code not in open(D+"login-codes.json").read())
n=len(mail())
s1,r1,_=req("/api/login/code", {"action":"send","email":"nobody@example.com"}, cookie=None)
s2,r2,_=req("/api/login/code", {"action":"send","email":"pend@example.com"}, cookie=None)
check("code login: same answer for strangers and pending members, no email", s1==200 and s2==200 and r1==r2=={"ok":True} and len(mail())==n, (r1,r2))
wrong="000000" if code!="000000" else "111111"
s,r,_=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":wrong}, cookie=None)
check("code login: wrong code refused", s==401, s)
s,r,ck=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":code}, cookie=None)
vc=cookie_from(ck,"gallery_visitor")
check("code login: right code signs the member in", s==200 and r.get("name")=="Mia Member" and vc, (s,r,ck))
s2,r2,_=req("/api/account/loyalty", cookie=vc, method="GET")
check("code login: the session works like a password sign-in", s2==200, (s2,r2))
s,r,_=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":code}, cookie=None)
check("code login: a code works only once", s==401, s)
reset_codes()
req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None); c1=last_code("mem@example.com")
req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None); c2=last_code("mem@example.com")
s,r,_=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":c1}, cookie=None)
check("code login: asking again cancels the older code", c1!=c2 and s==401 or c1==c2, (c1,c2,s))
s0,_,_=req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None)
s,r,_=req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None)
check("code login: at most 3 codes per 15 minutes", s0==200 and s==429, (s0,s,r))
reset_codes()
req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None); c=last_code("mem@example.com")
bad=[x for x in ["000000","111111","222222","333333","444444","555555"] if x!=c][:5]
for b in bad: req("/api/login/code", {"action":"verify","email":"mem@example.com","code":b}, cookie=None, ip="10.9.0.2")
s,r,_=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":c}, cookie=None, ip="10.9.0.3")
check("code login: 5 wrong guesses and the code is dead", s==401, s)
reset_codes()
req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None); c=last_code("mem@example.com")
rows=codes_file(); rows[-1]["expiresAt"]=int(time.time()*1000)-1000; json.dump(rows,open(D+"login-codes.json","w"))
s,r,_=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":c}, cookie=None, ip="10.9.0.4")
check("code login: expired code refused", s==401, s)
s,r,_=req("/api/login/code", {"action":"verify","email":"pend@example.com","code":"123456"}, cookie=None, ip="10.9.0.4")
check("code login: pending member can't sign in", s==401, s)
# password login still works for the admin backup
s,r,_=req("/api/login", {"role":"visitor","email":"mem@example.com","password":"wrongpass"}, cookie=None, ip="10.9.0.5")
check("password sign-in still answers normally", s==401, s)

# ---------------- admin sign-in links
reset_codes()
s,r,_=req("/api/login/link", {"action":"send","email":"support@example.com"}, cookie=None)
check("admin link: off by default (404)", s==404, s)
req("/api/admin/flags", {"key":"admin_magic_link","on":True})
s,r,_=req("/admin", cookie=None)
check("admin sign-in page offers the email link when on", "Email me a sign-in link" in r.get("_html",""), "")
n=len(mail())
s,r,_=req("/api/login/link", {"action":"send","email":"Support@Example.com"}, cookie=None)
m=[x for x in mail()[n:] if "sign-in link" in x.get("subject","")]
tok=re.search(r"/admin/link#([A-Za-z0-9_-]+)", m[0]["html"]).group(1) if m else None
check("admin link: support@ gets a link (token after #)", s==200 and tok and len(tok)>=40, (s,r,m[:1]))
n=len(mail())
s,r,_=req("/api/login/link", {"action":"send","email":"mem@example.com"}, cookie=None)
check("admin link: not on the staff list → same answer, no email", s==200 and r=={"ok":True} and len(mail())==n, r)
s,r,_=req("/admin/link", cookie=None)
check("admin link page loads", s==200, s)
s,r,_=req("/api/login/link", {"action":"verify","token":"x"*43}, cookie=None)
check("admin link: made-up token refused", s==401, s)
s,r,ck=req("/api/login/link", {"action":"verify","token":tok}, cookie=None)
ac=cookie_from(ck,"gallery_admin")
check("admin link: signs in", s==200 and ac, (s,r))
s,r,_=req("/api/login/link", {"action":"verify","token":tok}, cookie=None)
check("admin link: works only once", s==401, s)
s,r,_=req("/api/admin/admins", cookie=ac)
check("staff: dashboard knows who you are", s==200 and r["you"]=="support@example.com", r)
s,r,_=req("/api/admin/flags", {"key":"product_videos","on":True}, cookie=ac)
time.sleep(0.3)
aud=[json.loads(l) for l in open(D+"audit.jsonl")]
check("activity log: shows which staff member made a change", any(a["action"]=="flag.set" and a["actor"]=="support@example.com" for a in aud), aud[-2:])
check("activity log: records the link sign-in", any(a["action"]=="admin.signin" and a["actor"]=="support@example.com" for a in aud))
s,r,_=req("/api/admin/admins", {"admins":[{"email":"grace@example.com","name":"Grace"}]}, method="PUT", cookie=ac)
check("staff: can't remove yourself", s==400, (s,r))
s,r,_=req("/api/admin/admins", {"admins":[{"email":"support@example.com","name":"Support"},{"email":"Grace@Example.com","name":"Grace"}]}, method="PUT", cookie=ac)
check("staff: add someone", s==200 and [a["email"] for a in r["admins"]]==["support@example.com","grace@example.com"], (s,r))
s,r,_=req("/api/admin/admins", {"admins":[]}, method="PUT")
s2,r2,_=req("/api/admin/admins", {"admins":[{"email":"not-an-email"}]}, method="PUT")
check("staff: list can't be emptied or hold junk", s==400 and s2==400, (r,r2))
s,r,_=req("/api/admin/admins", {"admins":[{"email":"grace@example.com","name":"Grace"}]}, method="PUT")
check("staff: shared-password admin can remove someone", s==200, (s,r))
s,r,_=req("/api/admin/admins", cookie=ac)
check("staff: removed person's link session ends", s==401, s)
s,r,_=req("/api/admin/admins")
check("shared admin password still works as backup", s==200 and r["you"]=="admin", r)
s,r,_=req("/api/admin/admins", cookie=MEMBER)
check("staff list: admin only", s==401)

# ---------------- staff typing their email on the MEMBER sign-in → same dashboard link as /admin
reset_codes()
req("/api/admin/admins", {"admins":[{"email":"support@example.com","name":"Support"},{"email":"grace@example.com","name":"Grace"},{"email":"mem@example.com","name":"Mia"}]}, method="PUT")
s,r,_=req("/api/login/staff-check", {"email":" Grace@Example.com"}, cookie=None, ip="10.9.6.1")
s2,r2,_=req("/api/login/staff-check", {"email":"pend@example.com"}, cookie=None, ip="10.9.6.1")
check("staff check: member form spots a staff email (and only staff)", s==200 and r=={"staff":True} and r2=={"staff":False}, (r,r2))
req("/api/admin/flags", {"key":"email_code_login","on":False})
s,r,_=req("/api/login/staff-check", {"email":"grace@example.com"}, cookie=None, ip="10.9.6.4")
check("staff check: works without the member email-code switch (link only needs the staff switch)", r=={"staff":True}, r)
req("/api/admin/flags", {"key":"email_code_login","on":True})
for k in range(30): req("/api/login/staff-check", {"email":f"guess{k}@example.com"}, cookie=None, ip="10.9.6.2")
s,r,_=req("/api/login/staff-check", {"email":"grace@example.com"}, cookie=None, ip="10.9.6.2")
check("staff check: too many guesses from one address just get 'no'", r=={"staff":False}, r)
s,r,_=req("/admin", cookie=None)
check("admin page unchanged: still offers its own email link", "Email me a sign-in link" in r.get("_html",""), "")
# the member page sends the normal /admin link: dashboard session only
n=len(mail())
s,r,_=req("/api/login/link", {"action":"send","email":"mem@example.com"}, cookie=None, ip="10.9.1.1")
m=[x for x in mail()[n:] if "sign-in link" in x.get("subject","")]
tok=re.search(r"/admin/link#([A-Za-z0-9_-]+)", m[0]["html"]).group(1) if m else None
s,r,ck=req("/api/login/link", {"action":"verify","token":tok}, cookie=None, ip="10.9.1.1")
check("staff who is also a member: the link signs in to the dashboard only (so Preview store shows admin preview)", s==200 and cookie_from(ck,"gallery_admin") and not cookie_from(ck,"gallery_visitor"), (s,r))
# member email codes never open the dashboard any more
req("/api/login/code", {"action":"send","email":"mem@example.com"}, cookie=None, ip="10.9.1.3"); mc=last_code("mem@example.com")
s,r,ck=req("/api/login/code", {"action":"verify","email":"mem@example.com","code":mc}, cookie=None, ip="10.9.1.3")
check("member code: shop session only, even for a staff email", s==200 and "admin" not in r and not cookie_from(ck,"gallery_admin") and cookie_from(ck,"gallery_visitor"), (s,r))
n=len(mail())
s,r,_=req("/api/login/code", {"action":"send","email":"grace@example.com"}, cookie=None, ip="10.9.1.4")
check("member code: a staff email that isn't a member gets no code", s==200 and len(mail())==n, (s,r))
# admin links: up to 10 per 15 minutes per address (the link can't be guessed; this only stops inbox flooding)
reset_codes()
ok=[req("/api/login/link", {"action":"send","email":"grace@example.com"}, cookie=None, ip=f"10.9.7.{k}")[0] for k in range(10)]
s,r,_=req("/api/login/link", {"action":"send","email":"grace@example.com"}, cookie=None, ip="10.9.7.99")
check("admin links: 10 in 15 minutes are fine, the 11th waits", all(x==200 for x in ok) and s==429, (ok,s))
req("/api/admin/flags", {"key":"admin_magic_link","on":False})
s,r,_=req("/api/login/staff-check", {"email":"grace@example.com"}, cookie=None, ip="10.9.6.3")
check("staff check: says no while the staff switch is off", r=={"staff":False}, r)
req("/api/admin/flags", {"key":"admin_magic_link","on":True})
reset_codes()

# ---------------- staff "Log in as" a member (full access, clearly marked, 1 hour)
def page(path, cookie):
    r=urllib.request.Request(BASE+path); r.add_header("cookie", cookie)
    with urllib.request.urlopen(r, timeout=60) as resp: return resp.read().decode()
s,r,_=req("/api/admin/users/login-as", {"id":"u_member"}, cookie=None)
check("log in as: staff only", s==401, s)
s,r,_=req("/api/admin/users/login-as", {"id":"u_pending"})
check("log in as: only approved members", s==400, (s,r))
s,r,ck=req("/api/admin/users/login-as", {"id":"u_member"})
act=cookie_from(ck,"gallery_visitor")
mx=[c for c in ck if c.startswith("gallery_visitor=")]
check("log in as: member session for up to an hour, dashboard session kept", s==200 and act and "Max-Age=3600" in (mx[0] if mx else "") and not cookie_from(ck,"gallery_admin"), (s,r,ck))
html=page("/gallery", f"{ADMIN}; {act}")
check("log in as: their gallery shows the 'Signed in as … Back to admin' bar", "Signed in as" in html and "Back to admin" in html and "Mia" in html, "")
check("log in as: a member's own sign-in shows no such bar", "Signed in as" not in page("/gallery", MEMBER), "")
s,r,_=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup","paymentMethod":"invoice"}, cookie=f"{ADMIN}; {act}", ip="10.9.9.1")
oid=r.get("orderId") or r.get("order",{}).get("id")
o=[x for x in json.load(open(D+"orders.json")) if x["id"]==oid] if oid else []
check("log in as: an order placed for them says staff placed it", s==200 and o and o[0].get("placedBy")=="admin" and o[0]["userId"]=="u_member", (s,r,o[:1]))
s,r,_=req("/api/checkout", {"items":[{"productId":"p_mem","quantity":1}],"shippingMethod":"pickup","paymentMethod":"invoice"}, cookie=MEMBER, ip="10.9.9.2")
oid=r.get("orderId") or r.get("order",{}).get("id")
o=[x for x in json.load(open(D+"orders.json")) if x["id"]==oid] if oid else []
check("log in as: the member's own orders aren't marked", s==200 and o and "placedBy" not in o[0], (s,o[:1]))
s,r,ck=req("/api/admin/users/login-as", {"action":"end"}, cookie=f"{ADMIN}; {act}")
cleared=[c for c in ck if c.startswith("gallery_visitor=")]
check("log in as: Back to admin ends the member session", s==200 and cleared and ("Max-Age=0" in cleared[0] or "Expires=Thu, 01 Jan 1970" in cleared[0]), ck)
time.sleep(0.3)
aud=[json.loads(l) for l in open(D+"audit.jsonl")]
check("log in as: start and end are in the Activity log", any(a["action"]=="member.login_as" and a.get("targetId")=="u_member" and a["ok"] for a in aud) and any(a["action"]=="member.login_as_end" for a in aud), [a["action"] for a in aud[-5:]])
# ---------------- edit a member's address
s,r,_=req("/api/admin/users/profile", {"id":"u_member","address":{"addressLine1":" 12  Pine St ","addressLine2":"","city":"Bend","state":"OR","postalCode":"97701","phone":"541 555 0100"}}, method="PATCH")
u=[x for x in json.load(open(D+"users.json")) if x["id"]=="u_member"] if os.path.exists(D+"users.json") else []
uu=r.get("user",{})
check("member address: staff can change it (trimmed; empty line cleared)", s==200 and uu.get("addressLine1")=="12 Pine St" and uu.get("city")=="Bend" and uu.get("postalCode")=="97701" and not uu.get("addressLine2") and uu.get("phone")=="541 555 0100", (s,r))
time.sleep(0.3)
aud=[json.loads(l) for l in open(D+"audit.jsonl")]
check("member address: change logged with before/after", any(a["action"]=="member.profile_update" and (a.get("after") or {}).get("city")=="Bend" for a in aud))
s,r,_=req("/api/admin/users/profile", {"id":"u_member","address":{"city":"Bend"}}, method="PATCH", cookie=MEMBER)
check("member address: staff only", s==401, s)

req("/api/admin/admins", {"admins":[{"email":"support@example.com","name":"Support"}]}, method="PUT")
print(f"\n{sum(res)}/{len(res)} passed")
