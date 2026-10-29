// Venmo inbox: reading the email, the DKIM security check, and matching.
// Run: node tests/unit/venmo.cjs   (offline: a test key stands in for Venmo's)
const path = require("path"), fs = require("fs"), os = require("os");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const load = (file, deps = {}) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, file), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const req = (n) => (n in deps ? deps[n] : n === "mailauth" ? require(path.join(repo, "node_modules/mailauth")) : require(n));
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
};
const parse = load("lib/venmoParse.ts");
const match = load("lib/venmoMatch.ts");
const verify = load("lib/venmoVerify.ts", { "./venmoParse": parse });
const { build } = require(path.join(repo, "tests/e2e/venmo-sign.cjs"));

let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "venmo-"));
  process.env.DKIM_TEST_KEYS_FILE = path.join(dir, "keys.json");
  process.env.VENMO_ACCOUNT_EMAIL = "nicole@example.com";
  delete process.env.VERCEL;
  const mk = async (id, o = {}) => fs.readFileSync((await build(dir, repo, id, o)).file, "utf8");

  // ---- reading
  const good = await mk("good", { payer: "Shannon Garrett", amount: 64, note: "Consultation for Shannon Garrett #4K9Q2X", txn: "4123456789012345678" });
  let p = parse.parseVenmo(good);
  check("parse: payer, amount, note, transaction id", p.ok && p.payer === "Shannon Garrett" && p.amount === 64 && p.note === "Consultation for Shannon Garrett #4K9Q2X" && p.txnId === "4123456789012345678", p);
  p = parse.parseVenmo(await mk("html", { html: true, payer: "Ana María López", amount: 1234.5, note: "thank you!", txn: "" }));
  check("parse: HTML-only, base64, accents, $1,234.50", p.ok && p.payer === "Ana María López" && p.amount === 1234.5 && p.note === "thank you!" && !p.txnId, p);
  p = parse.parseVenmo(await mk("fwd", { fwd: true }));
  check("parse: a 'Fwd:' subject still reads", p.ok && p.payer === "Shannon Garrett", p);
  p = parse.parseVenmo(await mk("youpaid", { subject: "You paid Shannon Garrett $64.00" }));
  check("parse: 'You paid …' isn't a payment to us", !p.ok, p);
  p = parse.parseVenmo(await mk("request", { subject: "Shannon Garrett requests $64.00", note: "x" }).then((m) => m.replace(/paid you/g, "requests")));
  check("parse: a request isn't a payment", !p.ok, p);
  check("parse: encoded subject words", parse.decodeWords("=?utf-8?Q?Ana_Mar=C3=ADa?= =?utf-8?B?IHBhaWQgeW91?=") === "Ana María paid you", parse.decodeWords("=?utf-8?Q?Ana_Mar=C3=ADa?= =?utf-8?B?IHBhaWQgeW91?="));

  // ---- security
  let v = await verify.verifyVenmo(good);
  check("dkim: genuine Venmo email (signed d=venmo.com, aligned) passes", v.ok, v);
  v = await verify.verifyVenmo(await mk("t1", { tamper: ["$64.00", "$640.00"] }));
  check("dkim: amount changed after signing → quarantined", !v.ok, v);
  v = await verify.verifyVenmo(await mk("t2", { tamper: ["Shannon Garrett paid you $64.00", "Shannon Garrett paid you $99.00"], note: "x" }));
  check("dkim: subject changed after signing → quarantined", !v.ok, v);
  v = await verify.verifyVenmo(await mk("t3", { signDomain: "attacker.test" }));
  check("dkim: signed by another domain → quarantined", !v.ok && /attacker\.test/.test(v.reason), v);
  v = await verify.verifyVenmo(await mk("t4", { unsigned: true }));
  check("dkim: no signature → quarantined", !v.ok && /No DKIM/.test(v.reason), v);
  v = await verify.verifyVenmo(await mk("t5", { from: "Venmo <venmo@venmo-payments.test>", signDomain: "attacker.test" }));
  check("dkim: From not @venmo.com → quarantined", !v.ok && /Not from Venmo/.test(v.reason), v);
  v = await verify.verifyVenmo(await mk("t6", { to: "someone-else@example.com" }));
  check("dkim: a real Venmo email to someone else's account → quarantined", !v.ok && /not to the Venmo account/.test(v.reason), v);
  v = await verify.verifyVenmo(await mk("t7", { extraSubject: "Shannon Garrett paid you $900.00" }));
  check("dkim: a second Subject added on top → quarantined", !v.ok && /Subject/.test(v.reason), v);
  v = await verify.verifyVenmo(await mk("t8", { bodyLength: 40 }));
  check("dkim: signature covering only part of the body (l=) → quarantined", !v.ok, v);
  const was = process.env.VENMO_ACCOUNT_EMAIL; delete process.env.VENMO_ACCOUNT_EMAIL;
  v = await verify.verifyVenmo(good);
  check("dkim: without VENMO_ACCOUNT_EMAIL everything is quarantined", !v.ok && /VENMO_ACCOUNT_EMAIL/.test(v.reason), v);
  process.env.VENMO_ACCOUNT_EMAIL = was;
  process.env.VERCEL = "1";
  v = await verify.verifyVenmo(good);
  check("dkim: the test key is ignored on Vercel (real DNS only)", !v.ok, v);
  delete process.env.VERCEL;

  // ---- matching
  const now = Date.now();
  const orders = [
    { id: "ord_1_aaaaaa4k9q2x", userName: "Shannon Garrett", total: 64, createdAt: now },
    { id: "ord_2_bbbbbb7hh3mm", userName: "Samantha Lee", total: 42.5, createdAt: now },
    { id: "ord_3_cccccc1zz9qq", userName: "Pat Doe", total: 30, createdAt: now },
    { id: "ord_4_dddddd2yy8ww", userName: "Pat Doe", total: 30, createdAt: now },
    { id: "ord_5_eeeeee5xx5ee", userName: "Robin Hart", total: 18, createdAt: now },
  ];
  let m = match.matchPayment({ payer: "Someone Else", amount: 64, note: "Consultation for Shannon Garrett #4K9Q2X" }, orders);
  check("match: #ref in the note → strong", m.strength === "strong" && m.orderId === orders[0].id && !m.amountDiffers, m);
  m = match.matchPayment({ payer: "Shannon Garrett", amount: 60, note: "#4k9q2x" }, orders);
  check("match: #ref but a different amount → strong, flagged", m.strength === "strong" && m.amountDiffers === true, m);
  m = match.matchPayment({ payer: "X", amount: 64, note: "order 4K9Q2X thanks" }, orders);
  check("match: bare ref in the note → strong", m.strength === "strong" && m.orderId === orders[0].id, m);
  m = match.matchPayment({ payer: "Sam Lee", amount: 42.5, note: "tea!" }, orders);
  check("match: same amount + nickname (Sam ~ Samantha Lee) → medium", m.strength === "medium" && m.orderId === orders[1].id, m);
  m = match.matchPayment({ payer: "Shanon Garret", amount: 64, note: "" }, orders);
  check("match: same amount + misspelt name → medium", m.strength === "medium" && m.orderId === orders[0].id, m);
  m = match.matchPayment({ payer: "Pat Doe", amount: 30, note: "" }, orders);
  check("match: two orders, same name and amount → weak (a person picks)", m.strength === "weak" && !m.orderId && m.candidates.length === 2, m);
  m = match.matchPayment({ payer: "Jordan Blue", amount: 18, note: "for the tincture" }, orders);
  check("match: amount only → weak, never suggested", m.strength === "weak" && !m.orderId && m.candidates[0] === orders[4].id, m);
  m = match.matchPayment({ payer: "Jordan Blue", amount: 77, note: "" }, orders);
  check("match: nothing in common → none", m.strength === "none", m);
  m = match.matchPayment({ payer: "X", amount: 64, note: "", text: "See transaction https://venmo.com/#4K9Q2X" }, orders);
  check("match: a #ref inside a link doesn't count", m.strength !== "strong", m);
  check("names: different first names don't match", !match.namesMatch("John Smith", "Mary Smith"), null);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
