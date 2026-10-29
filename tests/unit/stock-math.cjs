// Backorders and restock needs (lib/stockMath.ts). Run: node tests/unit/stock-math.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/stockMath.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { backorders, restockNeeds } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const now = Date.parse("2026-10-28T18:00:00Z"), DAY = 86400000;
const products = [
  { id: "bar", name: "Festival Fun Bar" },
  { id: "tea", name: "Calm Tea" },
  { id: "oil", name: "Body Oil" },
  { id: "kit", name: "Starter Kit", isBundle: true, bundleProducts: ["bar", "tea"] },
];
const o = (status, items, taken, extra = {}) => ({ status, createdAt: now - DAY, items, stockTaken: taken, ...extra });
const orders = [
  o("pending", [{ productId: "bar", quantity: 19, restocking: true }], [{ productId: "bar", qty: 2 }]), // 17 owed
  o("paid", [{ productId: "bar", quantity: 1, restocking: true }], undefined),                          // 1 owed
  o("completed", [{ productId: "bar", quantity: 5, restocking: true }], undefined),                     // shipped: not owed
  o("cancelled", [{ productId: "bar", quantity: 4, restocking: true }], undefined),                     // not owed
  o("pending", [{ productId: "kit", quantity: 2, restocking: true }], [{ productId: "bar", qty: 2 }]),  // kit: tea 2 owed, bar 0
  o("pending", [{ productId: "tea", quantity: 1 }], [{ productId: "tea", qty: 1 }]),                    // covered
];
const b = backorders(orders, products);
check("backorder = ordered minus what the order actually took (19 − 2 = 17, + 1)", b.get("bar")?.units === 18 && b.get("bar")?.orders === 2, [...b]);
check("each waiting order is listed with its own amount", JSON.stringify(b.get("bar")?.list.map((x) => x.units)) === "[17,1]", b.get("bar")?.list)
check("completed and cancelled orders aren't owed", b.get("bar")?.units === 18, b.get("bar"));
check("a bundle line counts as its parts", b.get("tea")?.units === 2 && b.get("tea")?.orders === 1, b.get("tea"));
check("covered orders add nothing", !b.has("oil"), [...b]);
const back = backorders([o("pending", [{ productId: "bar", quantity: 3, restocking: true }], [{ productId: "bar", qty: 1 }], { stockReturnedAt: now })], products);
check("stock put back (un-cancelled order) → whole line owed", back.get("bar")?.units === 3, [...back]);

const sales = Array.from({ length: 30 }, (_, i) => o("completed", [{ productId: "oil", quantity: 1 }], undefined, { createdAt: now - i * DAY }));
const stock = new Map([["bar", 0], ["tea", 0], ["oil", 10], ["kit", 0]]);
const needs = restockNeeds(stock, [...orders, ...sales], products, now);
check("needs: owed first, most owed first", needs[0].id === "bar" && needs[0].why === "backorder" && needs[1].id === "tea", needs.map((n) => n.id));
check("needs: suggestion covers what's owed + 30 days of sales", needs[0].suggest === 18 + 27, needs[0]);
const oil = needs.find((n) => n.id === "oil");
check("needs: 10 left at 1 a day → about 10 days, flagged low", oil && oil.why === "low" && oil.daysLeft === 10 && oil.suggest === 20, oil);
check("needs: bundles themselves aren't listed", !needs.some((n) => n.id === "kit"), needs.map((n) => n.id));
check("needs: plenty in stock and no recent sales → not listed", restockNeeds(new Map([["oil", 50]]), [], products, now).length === 0, null);
check("needs: uncounted products are ignored", restockNeeds(new Map(), orders, products, now).length === 0, null);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
