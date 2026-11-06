// Seasonal entrance schedule (lib/entranceThemes.ts). Run: node tests/unit/entrance-themes.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const load = (file, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, file), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
};
// lib/periods.ts reads the business time zone from the brand config; these dates are plain calendar days.
const periods = load("lib/periods.ts", (m) => (m === "@/lib/brand" ? { brand: { timezone: "America/Los_Angeles" } } : require(m)));
const et = load("lib/entranceThemes.ts", (m) => (m === "./periods" ? periods : require(m)));

let pass = 0, fail = 0;
const check = (name, ok, got) => { ok ? pass++ : fail++; if (!ok) console.log("FAIL", name, got); };
const on = (d) => et.autoEntranceOn(d);
check("spring in April", on("2027-04-10") === "spring", on("2027-04-10"));
check("summer in July", on("2027-07-15") === "summer", on("2027-07-15"));
check("fall in early November", on("2026-11-02") === "fall", on("2026-11-02"));
check("winter in late January", on("2027-01-20") === "winter", on("2027-01-20"));
check("Halloween from Oct 15", on("2026-10-15") === "halloween" && on("2026-10-14") === "fall" && on("2026-10-31") === "halloween");
check("Thanksgiving week (Nov 26, 2026 is the 4th Thursday)", on("2026-11-20") === "thanksgiving" && on("2026-11-29") === "thanksgiving" && on("2026-11-19") === "fall" && on("2026-11-30") === "fall");
check("Thanksgiving moves with the calendar (Nov 25, 2027)", on("2027-11-19") === "thanksgiving" && on("2027-11-18") === "fall");
check("Holidays Dec 1–25", on("2026-12-01") === "holiday" && on("2026-12-25") === "holiday");
check("New Year Dec 26 – Jan 2", on("2026-12-26") === "newyear" && on("2027-01-02") === "newyear" && on("2027-01-03") === "winter");
check("Valentine's Feb 7–14", on("2027-02-07") === "valentines" && on("2027-02-14") === "valentines" && on("2027-02-15") === "winter");
check("St. Patrick's Mar 14–17", on("2027-03-14") === "stpatricks" && on("2027-03-17") === "stpatricks" && on("2027-03-18") === "spring");
check("Earth Day Apr 20–22", on("2027-04-20") === "earthday" && on("2027-04-22") === "earthday" && on("2027-04-23") === "spring");
check("Mother's Day week ends on the 2nd Sunday of May (May 9, 2027)", on("2027-05-03") === "mothersday" && on("2027-05-09") === "mothersday" && on("2027-05-02") === "spring" && on("2027-05-10") === "spring");
check("Mother's Day moves with the calendar (May 10, 2026)", on("2026-05-10") === "mothersday" && on("2026-05-04") === "mothersday" && on("2026-05-03") === "spring");
check("4th of July Jul 1–4", on("2027-07-01") === "july4" && on("2027-07-04") === "july4" && on("2027-07-05") === "summer" && on("2027-06-30") === "summer");
check("switch off = classic", et.resolveEntrance("halloween", false) === "classic" && et.resolveEntrance("auto", false) === "classic");
check("a chosen theme stays", et.resolveEntrance("summer", true, Date.UTC(2026, 11, 10)) === "summer");
check("auto follows the date", et.resolveEntrance("auto", true, Date.UTC(2026, 9, 20, 20)) === "halloween");
const sched = et.autoSchedule(Date.UTC(2026, 10, 2, 20), 4);
check("schedule lists the next changes in order", sched.map((c) => c.key).join(",") === "thanksgiving,fall,holiday,newyear" && sched[0].from === "2026-11-20", sched);
check("every theme has a label and colours", et.ENTRANCE_KEYS.every((k) => et.ENTRANCE_THEMES[k].label && et.ENTRANCE_THEMES[k].burst.length));
check("bad choices fall back to auto", et.cleanEntranceChoice("nope") === "auto" && et.cleanEntranceChoice("fall") === "fall");
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
