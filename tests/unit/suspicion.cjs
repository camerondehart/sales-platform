// Suspicious-activity detection (lib/suspicion.ts). Run: node tests/unit/suspicion.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/suspicion.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { findSuspicious, canonicalEmail, ipKey, addressKey, looksRandom } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

const now = Date.parse("2026-11-09T18:00:00Z"), DAY = 86400000, MIN = 60000;
let n = 0;
const user = (email, name, extra = {}) => ({ id: `u_${++n}`, email, name, status: "pending", createdAt: now - 2 * DAY - n * 3 * 3600000, ...extra });
const order = (email, name, total, extra = {}) => ({ id: `ord_${++n}_abc${String(n).padStart(3, "0")}`, userId: "x", userName: name, userEmail: email, total, status: "pending", createdAt: now - DAY, items: [{ quantity: 1 }], ...extra });
const ev = (kind, email, ip, at, extra = {}) => ({ id: `rk_${++n}`, kind, ref: "r", email, ip, at, ...extra });
const run = (users, orders = [], events = [], extra = {}) => findSuspicious({ users, orders, events, now, ...extra });
const has = (c, code) => !!c && c.reasons.some((r) => r.code === code);
const of = (cases, email) => cases.find((c) => c.people.some((p) => p.email === email));

// ---- helpers
check("gmail dots and +tags are one mailbox", canonicalEmail("J.o.h.n+shop@GoogleMail.com") === "john@gmail.com" && canonicalEmail("a.b+x@yahoo.com") === "a.b@yahoo.com");
check("IPv6 is compared by network, IPv4 whole, unknown ignored", ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd") === "2001:db8:1:2" && ipKey("203.0.113.7") === "203.0.113.7" && ipKey("unknown") === "" && ipKey("127.0.0.1") === "");
check("addresses match through spelling differences", addressKey({ addressLine1: "12 North Main Street", addressLine2: "Apt 4", postalCode: "86001-1234" }) === addressKey({ addressLine1: "12 N. Main St", addressLine2: "unit 4", postalCode: "86001" }));
check("a different apartment is a different address", addressKey({ addressLine1: "12 Main St", addressLine2: "Apt 4", postalCode: "86001" }) !== addressKey({ addressLine1: "12 Main St", addressLine2: "Apt 5", postalCode: "86001" }));
check("random-looking names are spotted, real ones aren't", looksRandom("asdfghjkl") && looksRandom("John123") && looksRandom("xxxx") && !looksRandom("Nguyen Schwartz") && !looksRandom("Mia Member") && !looksRandom("Wright Lynch"));

// ---- same internet address
{
  const us = ["a", "b", "c"].map((x, i) => user(`${x}fake@example.com`, `Person ${x.toUpperCase()}x`, { createdAt: now - DAY + i * MIN }));
  const cases = run(us, [], us.map((u, i) => ev("signup", u.email, "203.0.113.7", now - DAY + i * MIN, { country: "US", region: "AZ" })));
  const c = cases[0];
  check("3 requests from one address = one case with all 3 people", cases.length === 1 && c.people.length === 3 && has(c, "same-ip"), cases);
  check("…the reason names the address and the count", /3 membership requests under 3 different emails/.test(c.reasons[0].text) && /203\.0\.113\.7, AZ, US/.test(c.reasons[0].text) && /within a day/.test(c.reasons[0].text), c.reasons);
}
{
  const us = [user("wife@example.com", "Ann Home"), user("husband@example.com", "Bob Home")];
  const far = run(us, [], [ev("signup", us[0].email, "198.51.100.1", now - 9 * DAY), ev("signup", us[1].email, "198.51.100.1", now - 2 * DAY)]);
  check("two people on one connection, days apart, is not flagged", far.length === 0, far);
  const near = run(us, [], [ev("signup", us[0].email, "198.51.100.1", now - DAY), ev("signup", us[1].email, "198.51.100.1", now - DAY + 5 * MIN)]);
  check("…and minutes apart is a weak signal that alone stays hidden", near.length === 0, near);
  const both = run(us.map((u) => ({ ...u, message: "I heard about you from a friend at the market" })), [], [ev("signup", us[0].email, "198.51.100.1", now - DAY), ev("signup", us[1].email, "198.51.100.1", now - DAY + 5 * MIN)]);
  check("…but with a second signal (same note) it shows", both.length === 1 && has(both[0], "same-ip-pair") && has(both[0], "same-note"), both);
}
{
  const guests = ["g1", "g2", "g3"].map((g) => order(`${g}@shop.example`, `Guest ${g}`, 30));
  const cases = run([], guests, guests.map((o, i) => ev("order", o.userEmail, "2001:db8:1:2::" + i, now - DAY)));
  check("guest orders under 3 emails from one network are linked", cases.length === 1 && cases[0].people.every((p) => p.status === "guest") && cases[0].orders.length === 3, cases);
}

// ---- emails
{
  const cases = run([user("jo.hn@gmail.com", "John A"), user("john+2@gmail.com", "John B")]);
  check("the same mailbox written two ways is flagged", cases.length === 1 && has(cases[0], "same-mailbox"), cases);
  const series = run([user("sales1@example.com", "Aa Bb"), user("sales2@example.com", "Cc Dd"), user("sales33@example.com", "Ee Ff")]);
  check("numbered emails alone are only a weak signal (hidden)", series.length === 0, series);
  const thrown = run([user("x@mailinator.com", "Tess Temp")]);
  check("a throwaway inbox alone is hidden", thrown.length === 0, thrown);
  const both = run([user("x9@mailinator.com", "qwrtpsdfg")]);
  check("…a throwaway inbox plus a random-looking name shows", both.length === 1 && has(both[0], "throwaway-email") && has(both[0], "random-name"), both);
}

// ---- addresses, phones, notes
{
  const addr = { addressLine1: "500 Oak Avenue", city: "Springfield", state: "IL", postalCode: "62701" };
  const two = run([], [order("p1@example.com", "P One", 20, { shippingAddress: addr }), order("p2@example.com", "P Two", 20, { shippingAddress: { ...addr, addressLine1: "500 Oak Ave." } })]);
  check("a household (2 emails, one address) is not flagged", two.length === 0, two);
  const os = ["p1", "p2", "p3"].map((p) => order(`${p}@example.com`, `Buyer ${p}`, 20, { shippingAddress: addr, note: "Phone: (530) 555-0101" }));
  const three = run([], os);
  check("3 emails at one address with one phone are flagged", three.length === 1 && has(three[0], "same-address") && has(three[0], "same-phone"), three);
  const pick = run([], os.map((o) => ({ ...o, shippingMethod: "pickup", note: undefined })));
  check("pickup orders don't count as a shared address", pick.length === 0, pick);
}

// ---- orders
{
  const os = [1, 2, 3].map((i) => order("deadbeat@example.com", "Dee Beat", 80, { createdAt: now - i * 5 * DAY }));
  const cases = run([], os);
  check("3 orders and never paid is flagged, with the total", cases.length === 1 && has(cases[0], "never-paid") && /\$240\.00/.test(cases[0].reasons[0].text), cases);
  const good = run([], [...os, order("deadbeat@example.com", "Dee Beat", 80, { status: "completed", paidAt: now - 40 * DAY })]);
  check("…but not once they've paid for one", good.length === 0, good);
  const cash = run([], os.map((o) => ({ ...o, paymentMethod: "cash" })));
  check("cash-at-pickup orders waiting aren't 'never paid'", cash.length === 0, cash);
  const staff = run([], os.map((o) => ({ ...o, placedBy: "admin" })));
  check("orders staff placed with Log in as are ignored", staff.length === 0, staff);
  const burst = run([], [0, 1, 2, 3].map((i) => order("rush@example.com", "Rush Er", 25, { createdAt: now - DAY + i * 5 * MIN })));
  check("4 unpaid orders in an hour: both reasons, strong", burst.length === 1 && has(burst[0], "order-burst") && /4 orders within an hour/.test(burst[0].reasons.map((r) => r.text).join(" ")) && has(burst[0], "never-paid"), burst);
  const paid = Array.from({ length: 12 }, (_, i) => order(`ok${i}x@real.example`, `Okay ${"abcdefghijkl"[i]}`, 50, { status: "completed", paidAt: now - 20 * DAY }));
  const big = run([user("whale9@mailinator.com", "Big Spender")], [...paid, order("whale9@mailinator.com", "Big Spender", 900)]);
  check("a huge unpaid first order is called out against the typical order", has(of(big, "whale9@mailinator.com"), "big-first-order") && /typical paid order is about \$50/.test(of(big, "whale9@mailinator.com").reasons.map((r) => r.text).join(" ")), big);
  check("…and honest customers aren't flagged", big.length === 1, big.map((c) => c.people.map((p) => p.email)));
}

// ---- linked extras, recency, ids
{
  const us = [user("r.eject@gmail.com", "Rex One", { status: "rejected" }), user("reject+again@gmail.com", "Rex Two")];
  const cases = run(us);
  check("a new request linked to a rejected one says so", cases.length === 1 && has(cases[0], "linked-to-rejected") && cases[0].level === "look", cases);
  const os = us.map((u) => order(u.email, u.name, 20, { discountCode: "welcome10" }));
  const reuse = run(us, os, [], { limitedCodes: ["WELCOME10"] });
  check("a one-per-customer code used across linked emails is flagged (and makes it strong)", has(reuse[0], "code-reuse") && reuse[0].level === "strong", reuse);
  const old = run(us.map((u) => ({ ...u, createdAt: now - 200 * DAY })));
  check("old cases with nothing recent aren't listed", old.length === 0, old);
  const again = run(us);
  const grown = run([...us, user("rej.ect+3@gmail.com", "Rex Three")]);
  check("same people + same reasons = same id; a new linked account = a new id", again[0].id === cases[0].id && grown[0].id !== cases[0].id && /^sus_[a-z0-9]+$/.test(cases[0].id), [cases[0].id, grown[0].id]);
  const imported = run([user("im.port@gmail.com", "Old One", { importedFrom: "shopify", createdAt: now - DAY }), user("import+2@gmail.com", "Old Two", { status: "approved", createdAt: now - DAY, approvedAt: now - DAY })]);
  check("imported and staff-added members don't count as recent sign-ups", imported.length === 0, imported);
}
{
  const us = Array.from({ length: 6 }, (_, i) => user(`burst${"abcdef"[i]}@example${i}.com`, `Burst ${"abcdef"[i]}`, { createdAt: now - DAY + i * MIN, message: i < 2 ? "Please let me in, I love your goods a lot" : undefined }));
  const cases = run(us);
  check("6 requests in 10 minutes are grouped as a burst", cases.length === 1 && has(cases[0], "signup-burst") && cases[0].people.length === 6, cases);
}

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
