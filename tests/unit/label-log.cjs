// Bought Shippo labels log their shipping numbers (lib/labelLog.ts), and the
// Activity log's redaction keeps them while still hiding the service token.
// Run: node tests/unit/label-log.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const load = (file, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, file), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
};
const ll = load("lib/labelLog.ts", require);
const audit = load("lib/audit.ts", (m) => (m === "./auth" ? { adminActor: async () => "test" } : require(m)));
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

const rate = { amount: "9.85", currency: "USD", provider: "USPS", servicelevel: { name: "Priority Mail" }, object_id: "rate_1" };
const tx = { tracking_number: "9400111899223197428490", label_url: "https://shippo-delivery.s3.amazonaws.com/x.pdf", object_id: "tx_1", status: "SUCCESS" };
const f = ll.labelLogFields(rate, tx, "usps_priority");
check("tracking number", f.trackingNumber === "9400111899223197428490", f);
check("carrier", f.carrier === "USPS", f);
check("service name", f.service === "Priority Mail", f);
check("cost as a number", f.cost === 9.85, f);
check("label link", f.labelUrl === tx.label_url, f);
check("transaction id", f.transactionId === "tx_1", f);

const fallback = ll.labelLogFields({ amount: "n/a" }, {}, "usps_ground_advantage");
check("missing values stay empty", fallback.trackingNumber === null && fallback.cost === null && fallback.service === "usps_ground_advantage", fallback);

const body = { userId: "u_1", productName: "Sample", quantity: 1, weightOz: 8, serviceToken: "usps_priority" };
const logged = audit.redact({ ...body, ...f });
check("log keeps the shipping numbers", logged.trackingNumber === f.trackingNumber && logged.cost === 9.85 && logged.carrier === "USPS" && logged.labelUrl === f.labelUrl, logged);
check("service token stays redacted", logged.serviceToken === "[redacted]", logged);
check("no API key in the entry", !JSON.stringify(logged).includes("ShippoToken"), logged);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
