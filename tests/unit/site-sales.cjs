// Scheduled sitewide sales (lib/siteSaleRules.ts + sitePromo in lib/pricing.ts).
// Run: node tests/unit/site-sales.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const load = (file, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, file), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
};
// lib/periods.ts and lib/siteSaleRules.ts read the time zone from the brand config; the example brand is Pacific.
const req = (m) => (m === "@/lib/brand" || m === "./brand" ? { brand: { timezone: "America/Los_Angeles", timezoneLabel: "Pacific" } } : require(m));
const pr = load("lib/pricing.ts", req);
const ru = load("lib/siteSaleRules.ts", req);
const pt = load("lib/periods.ts", req);
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

// ---- prices
const site = (p, pct = 20) => ({ ...p, sitePromo: pct });
check("20% off $40", pr.effectivePrice(site({ price: "$40" })) === "$32");
check("odd cents round to the cent", pr.effectivePrice(site({ price: "$29.99" })) === "$23.99", pr.effectivePrice(site({ price: "$29.99" })));
check("better of own sale price and sitewide: sitewide cheaper", pr.effectivePrice(site({ price: "$29.99", salePrice: "$24.99" })) === "$23.99");
check("better of own sale price and sitewide: own cheaper", pr.effectivePrice(site({ price: "$40", salePrice: "$25" })) === "$25");
check("own 30% promo beats a 20% sitewide sale (no stacking)", pr.effectivePrice(site({ price: "$40", promo: { type: "percent", percent: 30 } })) === "$28");
check("BOGO products keep BOGO, no sitewide price", pr.effectivePrice(site({ price: "$40", promo: { type: "bogo", percent: 50 } })) === "$40" && pr.lineDiscount(site({ price: "$40", promo: { type: "bogo", percent: 50 } }), 2) === 20);
check("at most $100 off one item", pr.effectivePrice(site({ price: "$600" }, 50)) === "$500", pr.effectivePrice(site({ price: "$600" }, 50)));
check("Inquire-priced items untouched", pr.effectivePrice(site({ price: "Inquire" })) === "Inquire");
check("on sale + label + percent shown", pr.onSale(site({ price: "$40" })) && pr.promoLabel(site({ price: "$40" })) === "20% off" && pr.discountPercent(site({ price: "$40" })) === 20);
check("no sitePromo = exactly as before", pr.effectivePrice({ price: "$40" }) === "$40" && !pr.onSale({ price: "$40" }));
const cash = { price: "$40", salePrice: "$30", cashOnly: true };
check("cash-only deal: online gets the sitewide price", pr.effectivePrice(site(cash)) === "$32");
check("cash-only deal: cash pickup still gets its cheaper deal", pr.effectivePrice(pr.asCash(site(cash))) === "$30" && pr.cashDeal(site(cash)) === "$30 cash at pickup");
check("cash-only deal no better than the sale: no cash note", pr.cashDeal(site({ price: "$40", salePrice: "$35", cashOnly: true })) === null);

// ---- who's covered, when
const H = 3_600_000, now = Date.UTC(2026, 10, 27, 12);
const base = { id: "s", name: "BF", percent: 20, startsAt: now - H, endsAt: now + H, scope: "all", createdAt: 0, updatedAt: 0 };
const prods = [{ id: "a", category: "Tinctures" }, { id: "b", category: "Teas" }, { id: "c" }];
check("running now", ru.saleState(base, now) === "running" && ru.saleLive(base, now));
check("scheduled before start", ru.saleState(base, now - 2 * H) === "scheduled");
check("starts exactly on the minute", ru.saleLive(base, now - H) && !ru.saleLive(base, now - H - 1));
check("ended at its end", ru.saleState(base, now + H) === "ended");
check("ended early", ru.saleState({ ...base, endedAt: now - 1 }, now) === "ended");
check("cancelled before it started", ru.saleState({ ...base, endedAt: base.startsAt }, now - 2 * H) === "cancelled");
check("all products covered", ru.withSales(prods, [base], now).every((p) => p.sitePromo === 20));
check("chosen products only", ru.withSales(prods, [{ ...base, scope: "products", productIds: ["b"] }], now).map((p) => p.sitePromo || 0).join() === "0,20,0");
check("category (any case)", ru.withSales(prods, [{ ...base, scope: "category", category: "tinctures" }], now).map((p) => p.sitePromo || 0).join() === "20,0,0");
check("two sales at once: the bigger percent", ru.withSales(prods, [base, { ...base, id: "t", percent: 30, scope: "products", productIds: ["a"] }], now).map((p) => p.sitePromo).join() === "30,20,20");
check("not running: products untouched (same objects)", ru.withSales(prods, [base], now + 2 * H) === prods);

// ---- checks
const ok = (x) => ru.cleanSale({ name: "BF", percent: 20, startsAt: now - H, endsAt: now + H, ...x }, prods, now);
check("valid sale", ok({}).ok === true && ok({}).value.scope === "all");
check("needs a name", !ok({ name: " " }).ok);
check("percent 1-90 whole", !ok({ percent: 0 }).ok && !ok({ percent: 91 }).ok && !ok({ percent: 12.5 }).ok && ok({ percent: 90 }).ok);
check("end after start", !ok({ endsAt: now - H }).ok);
check("end in the past refused", !ok({ startsAt: now - 5 * H, endsAt: now - H }).ok);
check("at most 62 days", !ok({ endsAt: now + 63 * 24 * H }).ok);
check("chosen products must exist", !ok({ scope: "products", productIds: ["zz"] }).ok && ok({ scope: "products", productIds: ["a"] }).ok);
check("category must have products", !ok({ scope: "category", category: "Nope" }).ok && ok({ scope: "category", category: "Teas" }).ok && ok({ scope: "category", category: "teas" }).value.category === "Teas");

// ---- Black Friday whole day in Pacific
const st = pt.pacificToMs("2026-11-27T00:00"), last = pt.pacificToMs("2026-11-27T23:59");
const bf = { ...base, startsAt: st, endsAt: ru.endFromMinute(last) };
check("Black Friday starts 12:00 am Pacific (08:00 UTC)", new Date(st).toISOString() === "2026-11-27T08:00:00.000Z", new Date(st).toISOString());
check("runs through 11:59 pm, over at midnight Pacific", ru.saleLive(bf, pt.pacificToMs("2026-11-27T23:59") + 59_000) && !ru.saleLive(bf, pt.pacificToMs("2026-11-28T00:00")));
check("window reads in Pacific", ru.saleWindow(bf).replace(/\s/g, " ") === "Nov 27, 12:00 AM – Nov 27, 11:59 PM Pacific", ru.saleWindow(bf));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
