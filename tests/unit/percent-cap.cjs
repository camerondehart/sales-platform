// Percentage discounts take at most $100 off (lib/pricing.ts PERCENT_OFF_CAP).
// Run: node tests/unit/percent-cap.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const load = (file, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, file), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
};
const pr = load("lib/pricing.ts", require);
const bundles = load("lib/bundles.ts", (m) => (m === "./pricing" ? pr : require(m)));
// lib/discounts.ts: only validateDiscount is used here, so its storage imports are stubbed.
const stub = new Proxy({}, { get: () => function () { return {}; } });
const dc = load("lib/discounts.ts", (m) => (m === "./pricing" ? pr : m === "fs" || m === "path" ? require(m) : stub));
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

const code = (type, value) => ({ id: "d", code: "X", type, value, active: true, uses: 0, usedBy: [], createdAt: 0 });
const amt = (d, sub) => { const r = dc.validateDiscount(d, sub, "u"); return r.ok ? r.amount : r.error; };
check("20% code on $300: $60 as before", amt(code("percentage", 20), 300) === 60, amt(code("percentage", 20), 300));
check("20% code on $500: exactly $100", amt(code("percentage", 20), 500) === 100);
check("20% code on $800: capped at $100", amt(code("percentage", 20), 800) === 100, amt(code("percentage", 20), 800));
check("100% code on $900: capped at $100", amt(code("percentage", 100), 900) === 100);
check("100% code on $40: still the whole $40", amt(code("percentage", 100), 40) === 40);
check("fixed $150 code: not capped", amt(code("fixed", 150), 400) === 150, amt(code("fixed", 150), 400));

const big = { id: "a", price: "$600", promo: { type: "percent", percent: 25 } };
const small = { id: "b", price: "$50", promo: { type: "percent", percent: 20 } };
check("percent sale: at most $100 off a unit", pr.effectivePrice(big) === "$500", pr.effectivePrice(big));
check("percent sale under the cap unchanged", pr.effectivePrice(small) === "$40", pr.effectivePrice(small));
check("fixed sale price not capped", pr.effectivePrice({ price: "$600", salePrice: "$300" }) === "$300");

const bogo = { id: "c", price: "$60", promo: { type: "bogo", percent: 50 } };
check("BOGO under the cap unchanged", pr.lineDiscount(bogo, 4) === 60, pr.lineDiscount(bogo, 4));
check("BOGO: at most $100 per product", pr.lineDiscount(bogo, 10) === 100, pr.lineDiscount(bogo, 10));

const p1 = { id: "p1", price: "$80" }, p2 = { id: "p2", price: "$70" };
const pctBundle = { id: "b1", name: "Pair", items: [{ productId: "p1", qty: 1 }, { productId: "p2", qty: 1 }], type: "percent", value: 20, active: true, createdAt: 1, updatedAt: 1 };
const setBundle = { ...pctBundle, id: "b2", type: "price", value: 100 };
const two = (q) => [{ product: p1, quantity: q }, { product: p2, quantity: q }];
let r = bundles.priceCart(two(2), [pctBundle], null);
check("percent bundle under the cap unchanged (2 sets, $60)", r.bundleSavings === 60 && r.discount === 60, r);
r = bundles.priceCart(two(5), [pctBundle], null);
check("percent bundle: at most $100 per order (5 sets)", r.bundleSavings === 100 && r.discount === 100 && r.bundles[0].savings === 100, r);
r = bundles.priceCart(two(5), [setBundle], null);
check("set-price bundle not capped (5 sets, $250)", r.bundleSavings === 250, r);

const rule = { enabled: true, minItems: 3, percent: 10 };
r = bundles.priceCart([{ product: p1, quantity: 5 }], [], rule);
check("buy-N rule under the cap unchanged ($40)", r.ruleSavings === 40, r);
r = bundles.priceCart([{ product: p1, quantity: 20 }], [], rule);
check("buy-N rule: at most $100 per order", r.ruleSavings === 100 && r.discount === 100, r);

// The "(max $100 off)" note: flagged only when a saving reached the cap.
check("note text", pr.CAP_NOTE === " (max $100 off)", pr.CAP_NOTE);
r = bundles.priceCart(two(5), [pctBundle], null);
check("capped percent bundle is flagged", r.bundles[0].capped === true, r);
r = bundles.priceCart(two(2), [pctBundle], null);
check("bundle under the cap is not flagged", !("capped" in r.bundles[0]), r);
r = bundles.priceCart(two(5), [setBundle], null);
check("set-price bundle is never flagged", !("capped" in r.bundles[0]), r);
r = bundles.priceCart([{ product: p1, quantity: 20 }, { product: bogo, quantity: 10 }], [], rule);
check("capped BOGO and rule are flagged", r.promoCapped === true && r.ruleCapped === true, r);
r = bundles.priceCart([{ product: p1, quantity: 5 }, { product: bogo, quantity: 4 }], [], rule);
check("under the cap: no flags", !("promoCapped" in r) && !("ruleCapped" in r), r);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
