import json, time, os
os.chdir("/tmp/final/data")
now = int(time.time()*1000)
json.dump([
 {"id":"p_pub","name":"Harmony Blend Extract","description":"<p>A calming daily blend of reishi and ashwagandha.</p>","price":"$29.99","salePrice":"$24.99","image":"x","category":"Extracts","visibility":"both","createdAt":1},
 {"id":"p_mem","name":"Secret Member Tincture","description":"Members only.","price":"$40","image":"x","category":"Tinctures","visibility":"internal","createdAt":1},
 {"id":"p_hid","name":"Hidden Cacao Bar","description":"x","price":"$50","image":"x","category":"Cacao","visibility":"internal","createdAt":1},
], open("products.json","w"))
json.dump([
 {"id":"u_member","email":"mem@example.com","name":"Mia Member","passwordHash":"x","status":"approved","ageVerified":True,"createdAt":now-9e8,"approvedAt":now-8e8,"loyaltyPoints":120},
 {"id":"u_pending","email":"pend@example.com","name":"Paula Pending","passwordHash":"x","status":"pending","ageVerified":True,"createdAt":now-3600000},
], open("users.json","w"))
json.dump([
 {"id":"ord_1_abc4k9","userId":"retail","userName":"Pat Buyer","userEmail":"pat@example.com","items":[{"productId":"p_pub","productName":"Harmony Blend Extract","price":"$24.99","quantity":1}],"shippingMethod":"ship","shippingCost":10,"subtotal":24.99,"total":34.99,"isInquiry":False,"status":"paid","paymentToken":"t","createdAt":now-86400000,"source":"retail"},
 {"id":"ord_2_zzzzzz","userId":"u_member","userName":"Mia Member","userEmail":"mem@example.com","items":[{"productId":"p_mem","productName":"Secret Member Tincture","price":"$40","quantity":2},{"productId":"p_hid","productName":"Hidden Cacao Bar","price":"$50","quantity":1}],"shippingMethod":"pickup","shippingCost":0,"subtotal":80,"total":80,"isInquiry":False,"status":"pending","paymentToken":"t2","createdAt":now-3600000,"source":"member"},
], open("orders.json","w"))
json.dump([{"id":"e1","title":"Guided Nature Walk","description":"Learn to identify.","date":now+7*86400000,"location":"The studio","price":"$35","capacity":10,"waitlistCapacity":5,"type":"class","published":True,"createdAt":1}], open("events.json","w"))
for f in ["subscribers.json","discounts.json","registrations.json"]:
    json.dump([], open(f,"w"))
for f in ["assistant-config.json","assistant-usage.json","assistant-escalations.json","flags-development.json","email-templates.json","audit.jsonl","settings.json","banner.json"]:
    if os.path.exists(f): os.remove(f)
print("seeded")
