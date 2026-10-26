import json, urllib.request
BASE="http://127.0.0.1:3470"; GW="http://127.0.0.1:4555"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:500]}"))
def req(path, body=None, cookie=ADMIN, method=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data else "GET"))
    r.add_header("content-type","application/json"); r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def gw(p):
    with urllib.request.urlopen(GW+p) as r: return json.loads(r.read() or b"null") if p=="/__log" else r.read()

s,r=req("/api/admin/assistant", {"model":"anthropic/claude-opus-5.5","fallbackModel":"google/gemini-3.6-flash"}, method="PUT")
check("any model can be the backup (not just the recommended three)", s==200 and r["config"]["fallbackModel"]=="google/gemini-3.6-flash" and r["config"]["model"]=="anthropic/claude-opus-5.5", (s,r))
s,r=req("/api/admin/assistant", {"fallbackModel":"not a model!!"}, method="PUT")
check("nonsense backup id refused", s==400, (s,r))

gw("/__reset")
s,r=req("/api/assistant/chat", {"mode":"admin","messages":[{"role":"user","content":"opus snapshot please"}]})
log=gw("/__log")
check("Opus answers after a tool call (no silent fallback)", r["reply"].startswith("OPUS_ANSWER") and "FALLBACK" not in r["reply"], r)
second=[m for m in log[-1]["messages"] if m["role"]=="assistant" and m.get("tool_calls")]
check("its thinking is sent back unchanged with the tool result", second and second[0].get("reasoning_details")==[{"type":"reasoning.text","text":"Let me look that up.","signature":"sig-abc","format":"anthropic-claude-v1","index":0}], second)
check("backup still passed to the gateway for real outages", log[0]["models"]==["google/gemini-3.6-flash"], log[0]["models"])
check("room for thinking: admin max_tokens 4000", log[0].get("max_tokens")==4000, log[0].get("max_tokens"))
# Negative control: the OLD behaviour (thinking dropped) reproduces Cam's symptom in this mock
body={"model":"anthropic/claude-opus-5.5","models":["anthropic/claude-sonnet-4.6"],"messages":[{"role":"system","content":"x"},{"role":"user","content":"opus snapshot"},{"role":"assistant","content":None,"tool_calls":[{"id":"c1","type":"function","function":{"name":"business_snapshot","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":"{}"}]}
rq=urllib.request.Request(GW+"/v1/chat/completions", data=json.dumps(body).encode(), method="POST"); rq.add_header("content-type","application/json")
old=json.loads(urllib.request.urlopen(rq).read())
check("control: dropping the thinking = silently answered by the backup (the reported bug)", old["model"]=="anthropic/claude-sonnet-4.6" and old["choices"][0]["message"]["content"]=="FALLBACK_ANSWER", old)

s,r=req("/api/admin/assistant", {"model":"anthropic/claude-opus-5.5"})
check("Test button: Opus passes a real tool round trip", r.get("ok") and r.get("usedTool") and r["model"]=="anthropic/claude-opus-5.5" and "10am" in r["reply"], r)
tl=gw("/__log")[-2:]
check("Test button: never uses the backup, so problems can't hide", all(not x.get("models") for x in tl), [x.get("models") for x in tl])

s,r=req("/api/admin/assistant", {"model":"anthropic/broken-model"})
check("Test button: failure shows plain English + the gateway's reason", not r.get("ok") and "isn't available" in r["error"] and "Failed at the first reply" in r["error"] and "not found" in (r.get("detail") or ""), r)

s,r=req("/api/admin/assistant", {"model":"anthropic/claude-haiku-4.5"})
check("Test button: ordinary model still passes", r.get("ok"), r)

# restore defaults for other suites
req("/api/admin/assistant", {"model":"anthropic/claude-haiku-4.5","fallbackModel":"anthropic/claude-sonnet-4.6"}, method="PUT")
# Models that only accept tool_choice "auto" (meta/muse-spark-*-contributor)
urllib.request.urlopen(GW+"/__reset").read()
s,r=req("/api/admin/assistant", {"model":"meta/auto-only-1"})
check("Test button: 'auto'-only model passes the tool round trip", r.get("ok") and r.get("usedTool") and "10am" in r.get("reply",""), r)
tl=gw("/__log")
check("…after one refusal it's remembered: 'auto' is sent from then on", [x["tool_choice"] for x in tl]==["auto","none","auto"], [x["tool_choice"] for x in tl])
urllib.request.urlopen(GW+"/__reset").read()
s,r=req("/api/admin/assistant", {"model":"meta/auto-only-1"})
tl=gw("/__log")
check("…second test goes straight to 'auto' (no failed call)", r.get("ok") and [x["tool_choice"] for x in tl]==["auto","auto"], [x["tool_choice"] for x in tl])
s,ov=req("/api/admin/assistant")
sp=ov.get("spend",{})
check("spend by model for this month / 30 / 120 days, with cost per model", all(k in sp for k in ("month","d30","d120")) and sp["month"]["byModel"] and all("costUsd" in m and "requests" in m for m in sp["month"]["byModel"]) and abs(sum(m["costUsd"] for m in sp["month"]["byModel"])-sp["month"]["totals"]["costUsd"])<1e-6, sp.get("month"))
# Gateway reports a variant under its base name → still counted as the selected main model
req("/api/admin/assistant", {"model":"openai/gpt-6-luna-fastvariant","fallbackModel":"anthropic/claude-haiku-4.5"}, method="PUT")
r0=urllib.request.Request(BASE+"/api/assistant/chat", data=json.dumps({"mode":"admin","messages":[{"role":"user","content":"hello variant"}]}).encode(), method="POST"); r0.add_header("content-type","application/json"); r0.add_header("cookie",ADMIN)
body=json.loads(urllib.request.urlopen(r0).read())
s,ov=req("/api/admin/assistant")
keys=[m["key"] for m in ov["spend"]["month"]["byModel"]]
check("variant name from the gateway is counted under the selected main model (Main tag + price line up)", body.get("reply")=="VARIANT_ANSWER" and "openai/gpt-6-luna-fastvariant" in keys and "openai/gpt-6-luna" not in keys, (body, keys))
req("/api/admin/assistant", {"model":"anthropic/claude-haiku-4.5","fallbackModel":"anthropic/claude-sonnet-4.6"}, method="PUT")
print(f"\n{sum(res)}/{len(res)} passed")
