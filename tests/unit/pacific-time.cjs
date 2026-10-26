// Dashboard date/time boxes are read and filled in the business time zone (Pacific here), whatever the
// computer's own time zone (run with TZ=Asia/Bangkok etc. to prove it).
// Run: node tests/unit/pacific-time.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/periods.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
const req = (m) => (m === "@/lib/brand" ? { brand: { timezone: "America/Los_Angeles" } } : require(m));
new Function("module", "exports", "require", js)(mod, mod.exports, req);
const { pacificToMs, msToPacificInput, endOfPacificDay } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const iso = (t) => new Date(t).toISOString();
for (const zone of ["UTC", "Asia/Bangkok", "America/New_York", "America/Los_Angeles", "Pacific/Auckland"]) {
  process.env.TZ = zone;
  check(`${zone}: summer time 6:30pm PDT = 01:30Z next day`, iso(pacificToMs("2026-10-31T18:30")) === "2026-11-01T01:30:00.000Z", iso(pacificToMs("2026-10-31T18:30")));
  check(`${zone}: winter time 9am PST = 17:00Z`, iso(pacificToMs("2026-12-05T09:00")) === "2026-12-05T17:00:00.000Z", iso(pacificToMs("2026-12-05T09:00")));
  check(`${zone}: round trip into the box`, msToPacificInput(pacificToMs("2026-11-01T01:15")) === "2026-11-01T01:15", msToPacificInput(pacificToMs("2026-11-01T01:15")));
  check(`${zone}: "works until Oct 31" ends 11:59pm Pacific`, iso(endOfPacificDay("2026-10-31")) === "2026-11-01T06:59:59.999Z", iso(endOfPacificDay("2026-10-31")));
  check(`${zone}: day after DST ends`, iso(endOfPacificDay("2026-11-01")) === "2026-11-02T07:59:59.999Z", iso(endOfPacificDay("2026-11-01")));
}
check("unreadable → NaN", Number.isNaN(pacificToMs("soon")), pacificToMs("soon"));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
