// Cash-pickup-only sales (lib/pricing.ts). Run: node tests/unit/cash-pricing.cjs
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
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

const sale = { id: "a", price: "$40", salePrice: "$32", cashOnly: true };
const pct = { id: "b", price: "$50", promo: { type: "percent", percent: 20 }, cashOnly: true };
const bogo = { id: "c", price: "$20", promo: { type: "bogo", percent: 50 }, cashOnly: true };
const normal = { id: "d", price: "$30", salePrice: "$25" };

check("cash-only sale: regular price unless cash", pr.effectivePrice(sale) === "$40" && !pr.onSale(sale) && pr.discountPercent(sale) === null, pr.effectivePrice(sale));
check("cash-only sale: cash price when paying cash", pr.effectivePrice(pr.asCash(sale)) === "$32" && pr.onSale(pr.asCash(sale)));
check("cash-only % off: regular unless cash", pr.effectivePrice(pct) === "$50" && pr.promoLabel(pct) === null && pr.effectivePrice(pr.asCash(pct)) === "$40");
check("cash-only BOGO: no discount unless cash", pr.lineDiscount(bogo, 2) === 0 && pr.lineDiscount(pr.asCash(bogo), 2) === 10);
check("labels: cash deal named", pr.cashDeal(sale) === "$32 cash at pickup" && pr.cashDeal(pct) === "$40 cash at pickup" && pr.cashDeal(bogo) === "BOGO 50% off, cash at pickup", [pr.cashDeal(sale), pr.cashDeal(pct), pr.cashDeal(bogo)]);
check("normal sales unchanged", pr.effectivePrice(normal) === "$25" && pr.effectivePrice(pr.asCash(normal)) === "$25" && pr.cashDeal(normal) === null);
check("cash-only tick with no sale: no deal", pr.cashDeal({ price: "$10", cashOnly: true }) === null);
const lines = [{ product: sale, quantity: 1 }, { product: bogo, quantity: 2 }, { product: normal, quantity: 1 }];
const ship = bundles.priceCart(lines, [], null);
const cash = bundles.priceCart(lines.map((l) => ({ ...l, product: pr.asCash(l.product) })), [], null);
check("cart, not cash: regular prices for cash-only items", ship.subtotal === 40 + 40 + 25 && ship.discount === 0, ship);
check("cart, cash: cash prices apply", cash.subtotal === 32 + 40 + 25 && cash.discount === 10, cash);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
