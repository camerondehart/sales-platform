// What the passkey button calls the device's unlock (lib/unlockName.ts). Run: node tests/unit/unlock-name.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/unlockName.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { unlockName } = mod.exports;
let pass = 0, fail = 0;
const eq = (name, ua, want) => { const got = unlockName(ua); got === want ? pass++ : fail++; console.log(`${got === want ? "PASS" : "FAIL"} ${name}${got === want ? "" : ` -> ${got}`}`); };
eq("iPhone → Face ID", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1", "Face ID");
eq("Mac → Touch ID", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "Touch ID");
eq("Android → fingerprint", "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "fingerprint");
eq("Windows → Windows Hello", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Windows Hello");
eq("anything else → a passkey", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "a passkey");
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
