// Face ID / Touch ID answers are ECDSA signatures the passkey library must read.
// It failed on live ("Cannot get schema…") when two copies of @peculiar/asn1-schema
// were installed (package.json "overrides" keeps one). Run: node tests/unit/passkey-signature.cjs
const path = require("path"), crypto = require("crypto");
const repo = path.resolve(__dirname, "../..");
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + d}`); };
try {
  const { unwrapEC2Signature } = require(path.join(repo, "node_modules/@simplewebauthn/server/script/helpers/iso/isoCrypto/unwrapEC2Signature.js"));
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const sig = crypto.sign("sha256", Buffer.from("challenge"), privateKey);
  check("a P-256 signature can be read", unwrapEC2Signature(new Uint8Array(sig), 1).length === 64, "wrong length");
} catch (e) {
  check("a P-256 signature can be read", false, e.message);
}
const fs = require("fs");
const copies = [];
(function walk(dir, depth) {
  if (depth > 6) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (p.endsWith(path.join("@peculiar", "asn1-schema"))) copies.push(p);
    else if (fs.statSync(p).isDirectory() && (name === "node_modules" || name.startsWith("@") || dir.endsWith("node_modules") || /node_modules[\\/]@[^\\/]+$/.test(dir))) walk(p, depth + 1);
  }
})(path.join(repo, "node_modules"), 0);
check("only one copy of @peculiar/asn1-schema", copies.length === 1, copies.join(", "));
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
