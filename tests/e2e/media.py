import json, urllib.request, urllib.parse, base64, os, time
BASE="http://127.0.0.1:3470"; D="/tmp/final/data/"
T=json.load(open("/tmp/harness/tokens.json")); ADMIN=f"gallery_admin={T['admin']}"; MEMBER=f"gallery_visitor={T['member']}"
res=[]
def check(n,c,d=""):
    res.append(bool(c)); print(("PASS " if c else "FAIL ")+n+("" if c else f"  -> {str(d)[:400]}"))
def req(path, body=None, cookie=ADMIN, method=None):
    data=json.dumps(body).encode() if body is not None else None
    r=urllib.request.Request(BASE+path, data=data, method=method or ("POST" if data is not None else "GET"))
    r.add_header("content-type","application/json")
    if cookie: r.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp: return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def token_for(kind, pathname, cookie=ADMIN):
    return req("/api/admin/upload", {"type":"blob.generate-client-token","payload":{"pathname":pathname,"clientPayload":kind,"multipart":False}}, cookie=cookie)
def decode(ct):
    enc=ct.split("_")[4]; inner=base64.b64decode(enc+"==").decode().split(".")[1]
    return json.loads(base64.b64decode(inner+"==").decode())
def deleted():
    try: return open(D+"media-deleted.log").read()
    except FileNotFoundError: return ""
HOST="https://teststore123.public.blob.vercel-storage.com"
M=lambda p: f"{HOST}/media/{p}"

# --- upload tokens
s,r=token_for("image","media/images/lions-mane.jpg")
p=decode(r["clientToken"]) if s==200 else {}
check("photo: staff get a one-file upload token", s==200 and r["type"]=="blob.generate-client-token" and p.get("pathname")=="media/images/lions-mane.jpg", (s,r))
check("photo: only image types, 15 MB max, random name, no overwrite", "image/jpeg" in p.get("allowedContentTypes",[]) and "video/mp4" not in p["allowedContentTypes"] and p["maximumSizeInBytes"]==15*1024*1024 and p["addRandomSuffix"] is True and p["allowOverwrite"] is False, p)
check("token expires within 30 minutes", 0 < p["validUntil"]-time.time()*1000 <= 30*60_000+5000, p.get("validUntil"))
s,r=token_for("video","media/videos/harvest.mp4")
p=decode(r["clientToken"]) if s==200 else {}
check("video: MP4 only, 250 MB max", s==200 and p["allowedContentTypes"]==["video/mp4"] and p["maximumSizeInBytes"]==250*1024*1024, (s,p))
check("no 'upload finished' callback is registered", "onUploadCompleted" not in p, p.keys())
for kind,path,why in [("image","media/videos/x.jpg","photo into the video folder"),("video","media/images/x.mp4","video into the photo folder"),("image","users/v000001.json","outside media/"),("image","media/images/../../users.json","path tricks"),("", "media/images/x.jpg","no kind")]:
    s,r=token_for(kind,path)
    check(f"refused: {why}", s==400, (s,r))
s,r=token_for("image","media/images/x.jpg", cookie=MEMBER)
check("members can't upload", s==401, s)
s,r=token_for("image","media/images/x.jpg", cookie=None)
check("strangers can't upload", s==401, s)
s,r=req("/api/admin/upload", {"type":"blob.upload-completed","payload":{"blob":{"url":M("images/x.jpg")},"tokenPayload":"image"}}, cookie=None)
check("fake 'upload finished' calls are ignored", s in (400,401), s)
aud=[json.loads(l) for l in open(D+"audit.jsonl")]
check("activity log records uploads", any(a["action"]=="media.upload_image" and a["targetId"]=="media/images/lions-mane.jpg" for a in aud))

# --- product with uploaded photo + video
s,r=req("/api/admin/products", {"name":"Media Test","description":"x","price":"$10","image":M("images/one-abc.jpg"),"video":M("videos/clip-abc.mp4"),"visibility":"both"})
pid=r.get("product",{}).get("id")
check("product saves with an uploaded photo and MP4", s==200 and r["product"]["video"]==M("videos/clip-abc.mp4"), (s,r))
req("/api/admin/products", {"name":"Bundle borrowing photo","description":"x","price":"$20","image":M("images/shared-abc.jpg"),"visibility":"both"})
base={"id":pid,"name":"Media Test","description":"x","price":"$10","visibility":"both","video":M("videos/clip-abc.mp4")}
s,r=req("/api/admin/products", {**base,"image":M("images/two-abc.jpg")}, method="PUT")
check("replacing an uploaded photo deletes the old file", s==200 and M("images/one-abc.jpg") in deleted(), deleted())
s,r=req("/api/admin/products", {**base,"image":M("images/shared-abc.jpg")}, method="PUT")
s,r=req("/api/admin/products", {**base,"image":"https://example.com/photo.jpg"}, method="PUT")
check("a photo another product still uses is kept", M("images/shared-abc.jpg") not in deleted(), deleted())
s,r=req("/api/admin/products", {**base,"image":M("images/three-abc.jpg")}, method="PUT")
check("pasted links from other sites are never deleted", "example.com" not in deleted())
s,r=req("/api/admin/products", {**base,"image":M("images/three-abc.jpg"),"video":""}, method="PUT")
check("clearing the video deletes the uploaded MP4", M("videos/clip-abc.mp4") in deleted(), deleted())
s,r=req(f"/api/admin/products?id={pid}", method="DELETE")
check("deleting the product deletes its uploaded photo", s==200 and M("images/three-abc.jpg") in deleted(), deleted())
s,r=req("/api/admin/products", {"name":"Other store","description":"x","price":"$1","image":"https://otherstore.public.blob.vercel-storage.com/media/images/z.jpg","visibility":"both"})
oid=r["product"]["id"]; req(f"/api/admin/products?id={oid}", method="DELETE")
check("files in some other Blob store are never touched", "otherstore" not in deleted())

# --- events
s,r=req("/api/admin/events", {"title":"Walk","description":"x","date":int(time.time()*1000)+86400000*9,"location":"Here","image":M("images/ev1-abc.jpg")})
eid=r.get("event",{}).get("id")
s,r=req("/api/admin/events", {"id":eid,"image":M("images/ev2-abc.jpg")}, method="PATCH")
check("event: replaced photo deleted", s==200 and M("images/ev1-abc.jpg") in deleted(), (s,r))
s,r=req(f"/api/admin/events?id={eid}", method="DELETE")
check("event: deleting the event deletes its photo", M("images/ev2-abc.jpg") in deleted())

# --- discard (uploaded, replaced before saving)
s,r=req(f"/api/admin/upload?url={urllib.parse.quote(M('images/draft-abc.jpg'))}", method="DELETE")
check("discard an unsaved upload", s==200 and r["deleted"] is True and M("images/draft-abc.jpg") in deleted(), (s,r))
s,r=req(f"/api/admin/upload?url={urllib.parse.quote(M('images/shared-abc.jpg'))}", method="DELETE")
check("discard refuses a file that's in use", s==200 and r["deleted"] is False, (s,r))
s,r=req(f"/api/admin/upload?url={urllib.parse.quote('https://example.com/a.jpg')}", method="DELETE")
check("discard only works on our uploads", s==400)
s,r=req(f"/api/admin/upload?url={urllib.parse.quote(M('images/draft2-abc.jpg'))}", method="DELETE", cookie=MEMBER)
check("discard is staff only", s==401)
print(f"\n{sum(res)}/{len(res)} passed")
