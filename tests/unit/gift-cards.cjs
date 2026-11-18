// Gift card rules (lib/giftCardRules.ts): the buyer's bonus, amounts, how much a balance covers.
// Run: node tests/unit/gift-cards.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/giftCardRules.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const g = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

const rule = g.DEFAULT_GIFT_BONUS;
check("default rule is $5 per $50, up to $20", rule.enabled && rule.per === 5 && rule.step === 50 && rule.max === 20, rule);
check("$50 card: $5 bonus", g.giftBonusFor(50, rule) === 5);
check("$25 card: no bonus", g.giftBonusFor(25, rule) === 0);
check("$75 card: $5 (full $50s only)", g.giftBonusFor(75, rule) === 5);
check("$100 card: $10", g.giftBonusFor(100, rule) === 10);
check("$200 card: $20", g.giftBonusFor(200, rule) === 20);
check("$300 card: capped at $20", g.giftBonusFor(300, rule) === 20, g.giftBonusFor(300, rule));
check("$500 card: capped at $20", g.giftBonusFor(500, rule) === 20);
check("no max set: not capped", g.giftBonusFor(500, { enabled: true, per: 5, step: 50 }) === 50);
check("bonus off: nothing", g.giftBonusFor(200, { ...rule, enabled: false }) === 0);
check("no rule: nothing", g.giftBonusFor(200, null) === 0);
check("$10 per $100 rule: $150 -> $10", g.giftBonusFor(150, { enabled: true, per: 10, step: 100 }) === 10);
check("amounts: $10-$500 whole dollars", g.validGiftAmount(10) === 10 && g.validGiftAmount(500) === 500 && g.validGiftAmount(9) === null && g.validGiftAmount(501) === null && g.validGiftAmount(50.5) === null && g.validGiftAmount("x") === null);
check("balance covers up to the order", g.giftApplies(100, 50) === 50 && g.giftApplies(30, 50) === 30 && g.giftApplies(0, 50) === 0 && g.giftApplies(20, 0) === 0);
check("balance rounds to cents", g.giftApplies(10.004, 99) === 10);
check("unknown occasion falls back to Just because", g.occasionOf("nope") === "just-because" && g.occasionOf("birthday") === "birthday");
check("money: $50 and $12.50", g.giftMoney(50) === "$50" && g.giftMoney(12.5) === "$12.50");
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
