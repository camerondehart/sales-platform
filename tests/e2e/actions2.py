import json, urllib.request, urllib.parse, time, os
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:600]}"))
def http(method, path, body=None, cookie=ADMIN, headers=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method)
    r.add_header("content-type","application/json")
    for k,v in (headers or {}).items(): r.add_header(k,v)
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def tool(name, args=None, cookie=ADMIN, mode="admin"):
    s,r=http("POST","/api/assistant/chat",{"mode":mode,"messages":[{"role":"user","content":"TOOL:"+json.dumps({"name":name,"args":args or {}})}]}, cookie=cookie)
    return r
def card(r, i=0):
    a=r.get("actions") or []
    return a[i] if len(a)>i else None
executed=set()
def confirm(c):
    q=c["request"]; executed.add((q["url"].split("?")[0], q["method"]))
    return http(q["method"], q["url"], q.get("body"), headers={"x-fp-source":"assistant","x-fp-proposal":c["kind"]})
def mail():
    with urllib.request.urlopen(GW+"/__mail") as r: return json.loads(r.read())
def J(f, d=None):
    try: return json.load(open(D+f))
    except Exception: return d

# ================= members
n=len(mail())
r=tool("propose_create_member",{"name":"Nora New","email":"Nora@Example.com"})
c=card(r)
check("create member: card, nothing created yet", c and c["kind"]=="member_create" and not any(u["email"]=="nora@example.com" for u in J("users.json",[])), r)
check("create member: password never shown to the model", c and c["request"]["body"]["password"] not in r["reply"], r["reply"][:200])
s,o=confirm(c)
nora=[u for u in J("users.json",[]) if u["email"]=="nora@example.com"]
check("create member: confirmed → approved account, emailed", s==200 and nora and nora[0]["status"]=="approved" and any("account is ready" in m.get("subject","") for m in mail()[n:]), (s,o))
check("create member: duplicate refused", "already an account" in tool("propose_create_member",{"name":"X","email":"nora@example.com"})["reply"])
c=card(tool("propose_member_name",{"member_id":"u_member","name":"Mia M. Member"})); s,o=confirm(c)
check("rename member", s==200 and [u for u in J("users.json") if u["id"]=="u_member"][0]["name"]=="Mia M. Member", (s,o))
c=card(tool("propose_member_address",{"member_id":"u_member","address_line1":"9 Cedar Way","city":"Hood River","state":"OR","postal_code":"97031"}))
check("address card: shows old → new and saves on confirm", c and c["title"].startswith("Update") and any("9 Cedar Way" in l and "→" in l for l in c["lines"]), c)
s,o=confirm(c)
mu=[u for u in J("users.json",[]) if u["id"]=="u_member"]
check("address saved", s==200 and mu and mu[0].get("addressLine1")=="9 Cedar Way" and mu[0].get("city")=="Hood River", (s,o))
check("address: nothing to change says so", "already" in tool("propose_member_address",{"member_id":"u_member","city":"Hood River"})["reply"])
n=len(mail())
r=tool("propose_member_password_reset",{"member_id":"u_member"}); c=card(r)
pw=c["request"]["body"]["newPassword"]
s,o=confirm(c)
check("password reset: random password emailed, never in the chat text", s==200 and pw not in r["reply"] and any("password has been reset" in m.get("subject","") and pw in m["html"] for m in mail()[n:]), (s,o))

# ================= orders
n=len(mail())
r=tool("propose_manual_invoice",{"member_id":"u_member","items":[{"product":"Harmony Blend Extract","quantity":2}],"shipping":0,"note":"As discussed"})
c=card(r)
check("manual invoice card shows items and total", c and any("Harmony Blend Extract ×2" in l for l in c["lines"]) and any("$49.98" in l for l in c["lines"]), c)
before=len(J("orders.json",[]))
s,o=confirm(c)
check("manual invoice: pending order + invoice email", s==200 and len(J("orders.json",[]))==before+1 and any(m.get("to") in ("mem@example.com",["mem@example.com"]) for m in mail()[n:]), (s,o))
check("manual invoice: unknown product explained", "Couldn't find" in tool("propose_manual_invoice",{"member_id":"u_member","items":[{"product":"Nope"}]})["reply"])
check("shipping label: pickup orders refused", "pickup" in tool("propose_shipping_label",{"order_id":"ord_2_zzzzzz"})["reply"])
c=card(tool("propose_shipping_label",{"order_id":"ord_1_abc4k9","weight_oz":10}))
check("shipping label: red card that says it buys postage", c and c["danger"] and any("Shippo" in l for l in c["lines"]) and c["request"]["body"]=={"orderId":"ord_1_abc4k9","weightOz":10,"serviceToken":"usps_ground_advantage"}, c)
executed.add(("/api/admin/orders/shipping-label","POST"))  # not bought in tests (real postage)
c=card(tool("propose_reminder_action",{"order_id":"ord_2_zzzzzz","action":"stop"})); s,o=confirm(c)
check("reminders: stop for one order", s==200 and [x for x in J("orders.json") if x["id"]=="ord_2_zzzzzz"][0].get("remindersOff") is True, (s,o))
c=card(tool("propose_reminder_action",{"order_id":"ord_2_zzzzzz","action":"expire"}))
check("expire card: move an unpaid order to Expired by hand", c and c["title"].startswith("Move order") and any("not cancelled" in l for l in c["lines"]), c)
s,o=confirm(c)
eo=[x for x in J("orders.json",[]) if x["id"]=="ord_2_zzzzzz"]
check("expire: order is in Expired, still pending", s==200 and eo and eo[0].get("expiredAt") and eo[0]["status"]=="pending", (s,o))
check("expire: already-expired says so", "already in Expired" in tool("propose_reminder_action",{"order_id":"ord_2_zzzzzz","action":"expire"})["reply"])
c=card(tool("propose_reminder_action",{"order_id":"ord_2_zzzzzz","action":"revive"})); s,o=confirm(c)
check("expire → revive brings it back", s==200 and not [x for x in J("orders.json",[]) if x["id"]=="ord_2_zzzzzz"][0].get("expiredAt"), (s,o))
check("run reminders refused while switched off", "switched off" in tool("propose_run_reminders")["reply"])

# ================= products
r=tool("propose_create_product",{"name":"Chaga Tea","description":"Earthy and warming.","price":"$18","image_url":"https://example.com/chaga.jpg","category":"Teas","visibility":"both"})
c=card(r); s,o=confirm(c)
ch=[p for p in J("products.json") if p["name"]=="Chaga Tea"]
check("create product", s==200 and ch and ch[0]["visibility"]=="both" and ch[0]["price"]=="$18", (s,o))
cid=ch[0]["id"]
check("create product needs a photo link", "photo link" in tool("propose_create_product",{"name":"X","description":"y","price":"$1","image_url":"nope"})["reply"])
pr=J("products.json"); [p.update({"promo":{"type":"percent","percent":10}}) for p in pr if p["id"]==cid]; json.dump(pr,open(D+"products.json","w"))
r=tool("propose_edit_product",{"product_id":cid,"price":"$20","name":"Chaga Chai"}); c=card(r)
check("edit product: card lists before → after", c and "Price: $18 → $20" in c["lines"] and "Name: Chaga Tea → Chaga Chai" in c["lines"], c)
s,o=confirm(c)
p=[x for x in J("products.json") if x["id"]==cid][0]
check("edit product: saved, promo/photo/visibility kept", s==200 and p["name"]=="Chaga Chai" and p["price"]=="$20" and p.get("promo")=={"type":"percent","percent":10} and p["image"]=="https://example.com/chaga.jpg" and p["visibility"]=="both", p)
check("edit product: no-op explained", "Nothing would change" in tool("propose_edit_product",{"product_id":cid,"price":"$20"})["reply"])
order_before=[x["id"] for x in J("products.json")]
c=card(tool("propose_move_product",{"product_id":cid,"direction":"down"})); s,o=confirm(c)
order_after=[x["id"] for x in J("products.json")]
check("move product", s==200 and order_after.index(cid)==order_before.index(cid)+1, (order_before, order_after))

# ================= mix & match bundles
r=tool("propose_mix_bundle",{"name":"Tea & Calm","products":[{"product":"Chaga Chai"},{"product":"Harmony Blend Extract"}],"type":"percent","value":15})
c=card(r)
check("mix bundle card: set price preview + 'switched off' note", c and any("15% off the set" in l for l in c["lines"]) and any("switched OFF" in l for l in c["lines"]), c)
s,o=confirm(c); bid=o.get("bundle",{}).get("id")
check("mix bundle created", s==200 and bid, (s,o))
c=card(tool("propose_mix_bundle_update",{"bundle_id":bid,"active":False})); s,o=confirm(c)
check("mix bundle paused", s==200 and o["bundle"]["active"] is False, o)
c=card(tool("propose_mix_bundle_update",{"bundle_id":bid,"value":20})); s,o=confirm(c)
check("mix bundle deal changed (products kept)", s==200 and o["bundle"]["value"]==20 and len(o["bundle"]["items"])==2, o)
c=card(tool("propose_delete_product",{"product_id":cid}))
check("delete product: warns it's in a bundle", c and c["danger"] and any("Tea & Calm" in l for l in c["lines"]), c)
s,o=confirm(c)
check("delete product", s==200 and not any(x["id"]==cid for x in J("products.json")), (s,o))
c=card(tool("propose_delete_mix_bundle",{"bundle_id":bid})); s,o=confirm(c)
check("delete mix bundle", s==200 and not any(b["id"]==bid for b in J("bundles.json",[])), (s,o))

# ================= events
r=tool("propose_create_event",{"title":"Tea Workshop","start":"2027-03-05 18:00","location":"Studio","capacity":1,"waitlist":3,"price":"$20","description":"Brew along."})
c=card(r); s,o=confirm(c)
ev=o.get("event",{})
check("create event: draft by default, 6pm Pacific", s==200 and ev.get("published") is False and time.strftime("%H:%M", time.gmtime(ev["date"]/1000)) in ("02:00","01:00"), ev)
c=card(tool("propose_edit_event",{"event_id":ev["id"],"published":True,"price":"$25"})); s,o=confirm(c)
check("edit event: publish + price", s==200 and o["event"]["published"] is True and o["event"]["price"]=="$25", o)
for i in range(3): http("POST","/api/events/register",{"eventId":ev["id"],"name":f"Guest {i}","email":f"g{i}@example.com"}, cookie=None)
r=tool("list_events_admin",{"event_id":ev["id"]})
regs=json.loads(r["reply"].split("TOOLRESULT::",1)[1])["registrations"]
check("list registrations with ids", len(regs)==3 and regs[0]["status"]=="registered" and regs[1]["status"]=="waitlisted", regs)
c=card(tool("propose_registration_action",{"registration_id":regs[0]["id"],"action":"cancel"})); s,o=confirm(c)
st={x["id"]:x["status"] for x in json.loads(tool("list_events_admin",{"event_id":ev["id"]})["reply"].split("TOOLRESULT::",1)[1])["registrations"]}
check("cancel registration → first waitlisted moves in", s==200 and st[regs[0]["id"]]=="cancelled" and st[regs[1]["id"]]=="registered", st)
c=card(tool("propose_registration_action",{"registration_id":regs[2]["id"],"action":"promote"})); s,o=confirm(c)
check("promote off the waitlist", s==200, (s,o))
c=card(tool("propose_delete_event",{"event_id":ev["id"]}))
check("delete event: warns people are signed up", c and c["danger"] and any("signed up" in l for l in c["lines"]), c)
s,o=confirm(c)
check("delete event", s==200 and not any(e["id"]==ev["id"] for e in J("events.json",[])), (s,o))

# ================= discounts
http("POST","/api/admin/discounts",{"code":"TEAPARTY","type":"percentage","value":10})
c=card(tool("propose_discount_toggle",{"code":"teaparty","active":False})); s,o=confirm(c)
check("switch a code off", s==200 and [d for d in J("discounts.json") if d["code"]=="TEAPARTY"][0]["active"] is False, (s,o))
c=card(tool("propose_delete_discount",{"code":"TEAPARTY"})); s,o=confirm(c)
check("delete a code", s==200 and not any(d["code"]=="TEAPARTY" for d in J("discounts.json",[])), (s,o))

# ================= mailing list, campaigns, templates
for e in ["s1@example.com","s2@example.com"]:
    c=card(tool("propose_subscriber_add",{"email":e,"name":"Sub"})); confirm(c)
subs=J("subscribers.json",[])
check("add subscribers", sum(1 for x in subs if x["email"] in ("s1@example.com","s2@example.com"))==2, subs)
r=tool("propose_campaign",{"subject":"Spring teas","body":"# New teas\n\nCome see.","audience":"all","send_at":"2030-04-01 10:00"})
c=card(r)
check("campaign card: red, recipients counted, scheduled time", c and c["danger"] and any("people" in l for l in c["lines"]) and "Schedule" in c["confirmLabel"], c)
s,o=confirm(c)
camps=json.loads(tool("list_campaigns")["reply"].split("TOOLRESULT::",1)[1])["campaigns"]
sc=[x for x in camps if x["subject"]=="Spring teas"]
check("campaign scheduled (nothing sent)", s==200 and sc and sc[0]["status"]=="scheduled", (s,o,sc))
c=card(tool("propose_cancel_campaign",{"campaign_id":sc[0]["id"]})); s,o=confirm(c)
check("cancel scheduled campaign", s==200 and o["campaign"]["status"]=="cancelled", o)
n=len(mail())
c=card(tool("propose_campaign_test",{"subject":"Spring teas","body":"Hi"})); s,o=confirm(c)
check("test send to the team inbox only", s==200 and any(m.get("subject")=="[TEST] Spring teas" for m in mail()[n:]), (s,o))
c=card(tool("propose_template",{"name":"Spring tea note","subject":"Spring","body":"Hello","category":"spring"})); s,o=confirm(c)
tid=o.get("template",{}).get("id")
check("save template", s==200 and tid, (s,o))
c=card(tool("propose_template_archive",{"template_id":tid,"archived":True})); s,o=confirm(c)
check("archive template", s==200, (s,o))
c=card(tool("propose_template",{"template_id":"starter_fall","name":"Fall ritual","subject":"Fresh fall","body":"# Redone","category":"fall"}))
check("redo a built-in template: update card for the same id", c and c["title"].startswith("Update template") and c["request"]["body"]["id"]=="starter_fall", c)
check("unknown template ids refused", "No template with that id" in tool("propose_template",{"template_id":"starter_nope","name":"x","subject":"y","body":"z"})["reply"])
c=card(tool("propose_subscriber_remove",{"email":"s2@example.com"})); s,o=confirm(c)
check("remove subscriber", s==200 and not any(x["email"]=="s2@example.com" for x in J("subscribers.json",[])), (s,o))

# ================= settings
c=card(tool("propose_loyalty_settings",{"enabled":True,"points_per_dollar":2})); s,o=confirm(c)
st=J("settings.json",{})
check("loyalty settings (others untouched)", s==200 and st.get("loyaltyEnabled") is True and st.get("pointsPerDollar")==2 and st.get("pointsPerDollarRedeemed")==100, st)
c=card(tool("propose_feature_switch",{"key":"invoice_reminders","on":True})); s,o=confirm(c)
check("feature switch", s==200 and o.get("on") is True, o)
c=card(tool("propose_run_reminders")); s,o=confirm(c)
check("run reminders now (switch on)", s==200 and "sent" in o, o)
c=card(tool("propose_reminder_settings",{"reminder":1,"subject":"Hi {name}, about {ref}"})); s,o=confirm(c)
check("reminder wording", s==200 and o["settings"]["stages"][0]["subject"]=="Hi {name}, about {ref}", o)
c=card(tool("propose_staff_change",{"add_email":"grace@example.com","add_name":"Grace"}))
check("staff change is a red card", c and c["danger"], c)
s,o=confirm(c)
check("add staff", s==200 and any(a["email"]=="grace@example.com" for a in o["admins"]), o)
c=card(tool("propose_staff_change",{"remove_email":"grace@example.com"})); s,o=confirm(c)
check("remove staff", s==200 and not any(a["email"]=="grace@example.com" for a in o["admins"]), o)
n=len(mail())
c=card(tool("propose_send_report")); s,o=confirm(c)
check("send the nightly report now", s==200 and any("nightly report" in m.get("subject","") for m in mail()[n:]), (s,o))
old=J("assistant-config.json",[{}])
c=card(tool("propose_assistant_settings",{"add_knowledge_note":"Pickup is on Tuesdays.","monthly_cap":30})); s,o=confirm(c)
check("Concierge settings: note ADDED, existing knowledge kept", s==200 and o["config"]["knowledge"].endswith("Pickup is on Tuesdays.") and o["config"]["monthlyCapUsd"]==30, o.get("config",{}).get("knowledge","")[-200:])
c=card(tool("propose_knowledge_page",{"action":"add","url":"http://127.0.0.1:4555/site/about.html"})); s,o=confirm(c)
check("add a web page for the Concierge", s==200 and o.get("added")==1, o)

# ================= handed to the team
http("POST","/api/ask",{"items":[{"productId":"p_pub","quantity":1}],"question":"Is this ok with tea?"}, cookie=MEMBER)
reqs=json.loads(tool("list_handed_to_team")["reply"].split("TOOLRESULT::",1)[1])["requests"]
rq=[x for x in reqs if "tea" in x["summary"].lower()]
n=len(mail())
c=card(tool("propose_handoff_reply",{"request_id":rq[0]["id"],"reply":"Yes — it pairs well."})); s,o=confirm(c)
check("reply to a hand-off: emailed + resolved", s==200 and any("pairs well" in m.get("html","") for m in mail()[n:]), (s,o))
rm=[m for m in mail()[n:] if "pairs well" in m.get("html","")]
check("reply quotes the request passed to the team (not their last chat line)", rm and "Your request to our" in rm[0]["html"] and "Is this ok with tea?" in rm[0]["html"], rm and rm[0]["html"][-700:])
c=card(tool("propose_handoff_reply",{"request_id":rq[0]["id"],"reopen":True})); s,o=confirm(c)
check("reopen a hand-off", s==200, (s,o))

# ================= wrap-up
c=card(tool("propose_delete_member",{"member_id":nora[0]["id"]}))
check("delete member is a red card", c and c["danger"], c)
s,o=confirm(c)
check("delete member", s==200 and not any(u["email"]=="nora@example.com" for u in J("users.json",[])), (s,o))
r=tool("get_admin_settings")
check("settings overview readable", "feature_switches" in r["reply"] and "staff_sign_in_list" in r["reply"], r["reply"][:200])
r=tool("get_export_links")
check("download links", "/api/admin/orders/export" in r["reply"])
# ---- customers: points, sales and deals (deals_and_rewards)
http("POST","/api/admin/settings",{"partial":True,"loyaltyEnabled":True,"pointsPerDollar":2,"pointsPerDollarRedeemed":100,"minPointsToRedeem":100,"bundleRuleEnabled":True,"bundleRuleMinItems":3,"bundleRulePercent":10})
def toolres(r):
    t=r.get("reply","")
    return json.loads(t.split("TOOLRESULT::",1)[1]) if "TOOLRESULT::" in t else {}
dm=toolres(tool("deals_and_rewards", cookie=MEMBER, mode="site"))
check("member Concierge: explains points with their own balance", dm.get("loyalty",{}).get("how_it_works","").startswith("Members earn 2 points") and "your_points" in dm["loyalty"] and "worth_usd" in dm["loyalty"], dm)
check("member Concierge: knows the cart deal", "Buy 3 or more" in (dm.get("cart_deal") or ""), dm.get("cart_deal"))
dp=toolres(tool("deals_and_rewards", cookie=None, mode="site"))
check("public Concierge: explains points as members-only, no balance", dp.get("loyalty",{}).get("members_only") is True and "your_points" not in dp.get("loyalty",{}), dp.get("loyalty"))
check("public Concierge: only public-shop products in the sale list", "Secret Member Tincture" not in json.dumps(dp), dp.get("on_sale_now"))
r=tool("propose_delete_member",{"member_id":"u_member"}, cookie=MEMBER, mode="site")
check("members can't use staff tools", not r.get("actions") and "not available" in r["reply"].lower(), r)
aud=[json.loads(l) for l in open(D+"audit.jsonl")]
ai=[a for a in aud if a.get("source")=="ai"]
check("every confirmed card is in the Activity log as Concierge", len(ai)>=len(executed)-1, (len(ai), len(executed)))

# Coverage: every admin write the dashboard can do, except the deliberate exclusions
expected={("/api/admin/users","POST"),("/api/admin/users","PATCH"),("/api/admin/users","DELETE"),("/api/admin/users/profile","PATCH"),("/api/admin/users/password","POST"),
 ("/api/admin/send-invoice","POST"),("/api/admin/orders/shipping-label","POST"),("/api/admin/reminders","POST"),("/api/admin/reminders","PUT"),
 ("/api/admin/products","POST"),("/api/admin/products","PUT"),("/api/admin/products","PATCH"),("/api/admin/products","DELETE"),
 ("/api/admin/events","POST"),("/api/admin/events","PATCH"),("/api/admin/events","DELETE"),("/api/admin/discounts","PATCH"),("/api/admin/discounts","DELETE"),
 ("/api/admin/bundles","POST"),("/api/admin/bundles","PATCH"),("/api/admin/bundles","DELETE"),("/api/admin/campaigns","POST"),("/api/admin/campaigns","PATCH"),
 ("/api/admin/templates","POST"),("/api/admin/subscribers","POST"),("/api/admin/subscribers","DELETE"),("/api/admin/settings","POST"),("/api/admin/flags","POST"),
 ("/api/admin/admins","PUT"),("/api/admin/export-email","POST"),("/api/admin/assistant","PUT"),("/api/admin/assistant/sources","POST")}
executed={(u if not u.startswith("/api/admin/assistant/escalations/") else "/api/admin/assistant/escalations/[id]", m) for u,m in executed}
expected.add(("/api/admin/assistant/escalations/[id]","POST"))
missing=expected-executed
# users PATCH (approve/reject) is the existing propose_member_status tool — exercised in the admin-actions suite
missing.discard(("/api/admin/users","PATCH"))
check(f"coverage: every dashboard action has a Concierge card ({len(expected)} checked)", not missing, missing)
_t=json.loads(tool("list_templates",{"template_id":"Fall ritual"})["reply"].split("TOOLRESULT::",1)[1])
check("templates: the Concierge can read a template's subject and body (by name)", _t.get("template",{}).get("subject") and len(_t["template"].get("body",""))>20, _t)
_c=json.loads(tool("propose_discount_code",{"code":"ECHO5","type":"percentage","value":5,"max_uses":0})["reply"].split("TOOLRESULT::",1)[1])
check("cards: the model is told exactly what the card says (max_uses 0 = unlimited)", _c.get("card_shown") and "Unlimited uses" in _c["card_shown"][0]["details"], _c)
# ---------- campaigns to a customer group (segments)
_now=int(time.time()*1000)
_o=json.load(open(D+"orders.json"))
_o.append({"id":"ord_seg_old","userId":"u_member","userName":"Mia Member","userEmail":"mem@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":24.99,"total":24.99,"isInquiry":False,"status":"completed","paymentToken":"tseg","createdAt":_now-90*86400000,"paidAt":_now-90*86400000,"source":"member"})
json.dump(_o, open(D+"orders.json","w"))
_subs=json.load(open(D+"subscribers.json")) if os.path.exists(D+"subscribers.json") else []
_had=any(x.get("email","").lower()=="mem@example.com" and not x.get("unsubscribedAt") for x in _subs)
if not _had:
    _subs.append({"id":"sub_seg","email":"mem@example.com","name":"Mia Member","source":"member","unsubscribeToken":"useg","subscribedAt":_now-200*86400000})
    json.dump(_subs, open(D+"subscribers.json","w"))
_g=json.loads(tool("find_customer_group",{"segment":"lapsed_members","segment_days":60})["reply"].split("TOOLRESULT::",1)[1])
check("groups: lapsed members found by the server (no emails needed from the model)", _g.get("people_in_group",0)>=1 and _g.get("will_receive",0)>=1 and any("Mia" in x for x in _g.get("examples",[])), _g)
_r=tool("prepare_campaign_draft",{"subject":"We miss you","body":"Come back for 10% off.","segment":"lapsed_members"})
_d=_r.get("draft") or {}
check("groups: draft goes to the composer addressed to just that group", _d.get("audience")=="custom" and "mem@example.com" in _d.get("customList","") and "60+ days" in _d.get("groupLabel",""), _r)
_r=tool("propose_campaign",{"subject":"We miss you","body":"Come back for 10% off.","segment":"lapsed_members"})
_c=card(_r)
check("groups: send card names the group and sends only to it", _c and "60+ days" in " ".join(_c["lines"]) and _c["request"]["body"]["audience"]=="custom" and "mem@example.com" in _c["request"]["body"]["customList"], _r)
_r=tool("propose_campaign",{"subject":"x","body":"y","segment":"martians"})
check("groups: unknown group refused with the list of groups", not _r.get("actions") and "lapsed_members" in _r.get("reply",""), _r)
_r=tool("prepare_campaign_draft",{"subject":"x","body":"y","segment":"bought_product","segment_product":"Harmony Blend"})
check("groups: 'bought a product' group works by product name", (_r.get("draft") or {}).get("audience")=="custom" and "Harmony Blend" in (_r.get("draft") or {}).get("groupLabel",""), _r)
# ---------- members get campaigns unless they unsubscribe (Terms §9)
import hmac, hashlib, base64
_u=json.load(open(D+"users.json"))
_u.append({"id":"u_quiet","email":"quiet@example.com","name":"Quinn Quiet","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":_now-400*86400000,"approvedAt":_now-399*86400000})
json.dump(_u, open(D+"users.json","w"))
_o=json.load(open(D+"orders.json"))
_o.append({"id":"ord_quiet_old","userId":"u_quiet","userName":"Quinn Quiet","userEmail":"quiet@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":24.99,"total":24.99,"isInquiry":False,"status":"completed","paymentToken":"tq","createdAt":_now-100*86400000,"paidAt":_now-100*86400000,"source":"member"})
json.dump(_o, open(D+"orders.json","w"))
_g=json.loads(tool("find_customer_group",{"segment":"lapsed_members"})["reply"].split("TOOLRESULT::",1)[1])
check("members: a member who isn't on the mailing list still gets group campaigns", _g.get("people_in_group")==_g.get("will_receive") and _g.get("will_receive",0)>=2, _g)
_c=card(tool("propose_campaign",{"subject":"We miss you","body":"Come back.","segment":"lapsed_members"}))
check("members: send card counts them", _c and f"{_g.get('will_receive')} people" in " ".join(_c["lines"]), _c)
def _tok(e):
    sig=base64.urlsafe_b64encode(hmac.new(b"test-secret-at-least-32-characters-long!!", ("unsub:"+e).encode(), hashlib.sha256).digest()).decode().rstrip("=")[:22]
    return "m."+base64.urlsafe_b64encode(e.encode()).decode().rstrip("=")+"."+sig
def _page(t):
    try:
        with urllib.request.urlopen(BASE+"/unsubscribe?token="+urllib.parse.quote(t), timeout=30) as r: return r.read().decode()
    except urllib.error.HTTPError as e: return e.read().decode()
_bad=_page(_tok("quiet@example.com")[:-2]+"xx")
check("members: a tampered unsubscribe link does nothing", "unsubscribed" not in _bad.lower() or "couldn" in _bad.lower(), _bad[:200])
_ok=_page(_tok("quiet@example.com"))
check("members: their unsubscribe link works", "quiet@example.com" in _ok and "unsubscribed" in _ok.lower(), _ok[:300])
_subs=json.load(open(D+"subscribers.json"))
check("members: an opt-out record is saved", any(x["email"]=="quiet@example.com" and x.get("unsubscribedAt") for x in _subs), _subs[-2:])
_g2=json.loads(tool("find_customer_group",{"segment":"lapsed_members"})["reply"].split("TOOLRESULT::",1)[1])
check("members: after unsubscribing they're skipped", _g2.get("will_receive")==_g.get("will_receive")-1, (_g,_g2))
_s,_r=http("POST","/api/signup",{"name":"Nora Nope","email":"nora.nope@example.com","password":"longenough123","ageVerified":True,"subscribe":False}, cookie=None, headers={"x-forwarded-for":"9.9.1.1"})
_subs=json.load(open(D+"subscribers.json"))
check("members: unticking 'Keep me posted' at sign-up is remembered as an opt-out", _s==200 and any(x["email"]=="nora.nope@example.com" and x.get("unsubscribedAt") for x in _subs), (_s,_r))
print(f"\n{sum(res)}/{len(res)} passed")
