// Shared staff sign-ins are limited per device, with a site-wide backstop (lib/rateLimit.ts).
// Run: node tests/unit/rate-limit.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/rateLimit.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const rl = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
for (let i = 0; i < 12; i++) rl.recordSharedFailure("admin-password", "1.1.1.1");
check("12 failures block that device", rl.checkSharedLimit("admin-password", "1.1.1.1").blocked);
check("another device is not blocked", !rl.checkSharedLimit("admin-password", "2.2.2.2").blocked);
check("another sign-in type isn't blocked for others", !rl.checkSharedLimit("admin-link", "3.3.3.3").blocked);
for (let d = 0; d < 20; d++) for (let i = 0; i < 10; i++) rl.recordSharedFailure("admin-link", `9.9.${d}.1`);
check("200 failures site-wide (many devices) trip the backstop", rl.checkSharedLimit("admin-link", "4.4.4.4").blocked);
check("…for that sign-in type only", !rl.checkSharedLimit("admin-passkey", "4.4.4.4").blocked);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
