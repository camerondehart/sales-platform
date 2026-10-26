import json, random, time
random.seed(7)
D="/tmp/final/data/"; now=int(time.time()*1000); DAY=86400000
prods=[("p_lion","Lion's Mane Tincture","Tinctures",40),("p_reishi","Reishi Calm Drops","Tinctures",38),("p_coffee","Morning Coffee Blend","Blends",29.99),
       ("p_chaga","Chaga Chai","Blends",24),("p_cord","Cordyceps Capsules","Capsules",45),("p_tail","Turkey Tail Capsules","Capsules",35),("p_dead","Dusty Old Salve","Topicals",20)]
json.dump([{"id":i,"name":n,"description":"x","price":f"${p}","image":"x","category":c,"visibility":"both","createdAt":1} for i,n,c,p in prods], open(D+"products.json","w"))
custs=[(f"cust{i}@example.com",f"Customer {i}") for i in range(300)]+[("ann@example.com","Ann Big"),("bob@example.com","Bob Regular")]
users=[{"id":f"u{i}","email":e,"name":n,"passwordHash":"x","status":"approved" if i%3==0 else "pending","createdAt":1} for i,(e,n) in enumerate(custs)]
json.dump(users, open(D+"users.json","w"))
orders=[]
def order(i, email, name, t, items, status="paid", source="member", ship="ship", code=None):
    sub=sum(p*q for _,_,_,p,q in items)
    o={"id":f"ord_{i}","userId":f"guest_{email}" if source=="retail" else f"u_{email}","userName":name,"userEmail":email,
       "items":[{"productId":pid,"productName":n,"price":f"${p}","quantity":q} for pid,n,_,p,q in items],
       "shippingMethod":ship,"shippingCost":10 if ship=="ship" else 0,"subtotal":sub,"total":round(sub+(10 if ship=="ship" else 0),2),
       "isInquiry":False,"status":status,"paymentToken":f"t{i}","createdAt":t,"paidAt":t+3600000 if status in("paid","completed") else None,"source":source}
    if code: o["discountCode"]=code; o["discountAmount"]=5.0; o["total"]=round(o["total"]-5,2); o["discount"]=5.0
    if o["paidAt"] is None: del o["paidAt"]
    return o
i=0
for _ in range(1500):
    e,n=random.choice(custs[:300]); t=now-random.randint(0,400)*DAY-random.randint(0,DAY)
    k=random.choice([1,1,2,3]); items=[]
    for p in random.sample(prods[:6],k): items.append((p[0],p[1],p[2],p[3],random.randint(1,3)))
    st=random.choices(["paid","completed","pending","cancelled","inquiry"],[30,50,8,7,5])[0]
    orders.append(order(i,e,n,t,items,st,random.choice(["member","retail"]),random.choice(["ship","pickup"]),random.choice([None]*8+["FALL15"]))); i+=1
# Ann: big spender, recent
for d in [2,5,9,20,25]:
    orders.append(order(i,"ann@example.com","Ann Big",now-d*DAY,[("p_cord","Cordyceps Capsules","Capsules",45,5)],"completed")); i+=1
# Bob: regular who lapsed (last order 120 days ago)
for d in [120,150,200,260]:
    orders.append(order(i,"bob@example.com","Bob Regular",now-d*DAY,[("p_lion","Lion's Mane Tincture","Tinctures",40,4)],"completed")); i+=1
json.dump(orders, open(D+"orders.json","w"))
print(len(orders))
