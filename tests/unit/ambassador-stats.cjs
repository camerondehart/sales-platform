// Ambassador numbers: commission, owed, months, trial (lib/ambassadorStats.ts). Run: node tests/unit/ambassador-stats.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/ambassadorStats.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { ambassadorStats, netOf, trialOf } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

const now = Date.parse("2026-10-29T19:00:00Z"); // Oct 29, noon Pacific
const DAY = 86400000;
const terms = { commissionPct: 15, growthOn: false, trialDays: 90, startDate: "2026-10-01", windowDays: 30, repeatPurchases: true, payoutSchedule: "monthly" };
const o = (id, status, total, ship, at, rate, items = [{ productName: "Harmony Blend", quantity: 1 }]) => ({ id: `ord_${id}`, status, total, shippingCost: ship, createdAt: at, items, ambassador: { id: "a1", via: "page", ...(rate ? { rate } : {}) } });
const orders = [
  o("aaaaa1", "paid", 34.99, 10, now - 2 * DAY, 15),                 // net 24.99 → 3.75
  o("aaaaa2", "completed", 110, 10, now - 3 * DAY, 20),              // net 100 at 20% → 20.00
  o("aaaaa3", "pending", 60, 0, now - 1 * DAY, 15),                  // pickup, unpaid → pending 9.00
  o("aaaaa4", "cancelled", 200, 10, now - 1 * DAY, 15),              // left out
  o("aaaaa5", "paid", 50, 10, Date.parse("2026-09-20T19:00:00Z")),   // no rate stored → current 15% → 6.00
];
const s = ambassadorStats({ terms, currentRate: 15, orders, visits: { "2026-10-28": 40, "2026-09-20": 10 }, qr: { "2026-10-28": 5 }, payouts: [{ id: "p1", at: now - DAY, amount: 10 }], now });
check("net sales = paid total minus shipping", netOf({ total: 34.99, shippingCost: 10 }) === 24.99);
check("earned only on paid/completed, each at its own rate (3.75 + 20 + 6)", s.earned === 29.75 && s.earnedAllTime === 29.75, s);
check("unpaid orders show as pending commission", s.pending === 9 && s.pendingSales === 60, s);
check("cancelled orders are left out entirely", s.orders === 4 && !s.list.some((x) => x.ref === "AAAAA4"), s.orders);
check("owed = earned all-time minus payouts", s.paidOut === 10 && s.owed === 19.75, s);
check("visits, QR scans and conversion", s.visits === 50 && s.qrScans === 5 && s.conversion === 8, s);
check("month by month, newest first", s.months[0].month === "2026-10" && s.months[0].orders === 3 && s.months[0].earned === 23.75 && s.months[1].month === "2026-09" && s.months[1].visits === 10, s.months);
check("top products by units", s.topProducts[0].name === "Harmony Blend" && s.topProducts[0].units === 4, s.topProducts);
const oct = ambassadorStats({ terms, currentRate: 15, orders, visits: { "2026-10-28": 40, "2026-09-20": 10 }, qr: {}, payouts: [{ id: "p1", at: now - DAY, amount: 10 }], now, range: { from: Date.parse("2026-10-01T07:00:00Z"), to: now } });
check("a period counts only its orders and visits, owed stays all-time", oct.orders === 3 && oct.earned === 23.75 && oct.visits === 40 && oct.owed === 19.75, oct);
check("trial: day 29 of 90, 61 days left", s.trial.status === "trial" && s.trial.day === 29 && s.trial.daysLeft === 61 && s.trial.ends === "2026-12-29", s.trial);
check("trial over → review due, then done once reviewed", trialOf({ trialDays: 30, startDate: "2026-09-01" }, now).status === "review" && trialOf({ trialDays: 30, startDate: "2026-09-01", trialReviewed: true }, now).status === "done");
check("no trial", trialOf({ trialDays: 0, startDate: "2026-09-01" }, now).status === "none");
check("owed never goes below zero", ambassadorStats({ terms, currentRate: 15, orders: [], visits: {}, qr: {}, payouts: [{ id: "x", at: now, amount: 50 }], now }).owed === 0);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
