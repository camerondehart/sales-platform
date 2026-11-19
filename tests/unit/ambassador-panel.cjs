// Ambassador panel date ranges and chart buckets (lib/ambassadorPanelMath.ts). Run: node tests/unit/ambassador-panel.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/ambassadorPanelMath.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { rangeDays, panelSeries, previousRange, cleanRange, sumDays, shiftDay } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };

check("shiftDay crosses months and years", shiftDay("2026-12-31", 1) === "2027-01-01" && shiftDay("2026-03-01", -1) === "2026-02-28");
check("30 days ends today and includes it", JSON.stringify(rangeDays("30", "2026-11-18", "2026-01-01")) === JSON.stringify({ from: "2026-10-20", to: "2026-11-18" }));
check("7 days", rangeDays("7", "2026-11-18", "2026-01-01").from === "2026-11-12");
check("all time starts on their start date", rangeDays("all", "2026-11-18", "2026-01-01").from === "2026-01-01");
check("all time never starts after today (future start date)", rangeDays("all", "2026-11-18", "2027-01-01").from === "2026-11-18");
check("the period before is the same length, just before", JSON.stringify(previousRange("30", "2026-10-20")) === JSON.stringify({ from: "2026-09-20", to: "2026-10-19" }) && previousRange("all", "2026-01-01") === null);
check("unknown ranges fall back to 30 days", cleanRange("<x>") === "30" && cleanRange("365") === "365" && cleanRange(undefined) === "30");
check("sumDays counts only days in range", sumDays({ "2026-11-01": 2, "2026-11-10": 3, "2026-12-01": 9 }, "2026-11-01", "2026-11-30") === 5);

const d = panelSeries("2026-11-12", "2026-11-18", { "2026-11-12": 4, "2026-11-18": 1, "2026-11-01": 50 }, [{ day: "2026-11-18", net: 10.1 }, { day: "2026-11-18", net: 0.2 }, { day: "2026-10-01", net: 99 }]);
check("by day: every day is there, even empty", d.unit === "day" && d.points.length === 7 && d.points[3].visits === 0, d);
check("by day: visits and orders land on their day; outside the range ignored", d.points[0].visits === 4 && d.points[6].visits === 1 && d.points[6].orders === 2 && d.points[6].sales === 10.3, d.points);
check("by day: labels read like Nov 12", d.points[0].label === "Nov 12", d.points[0]);
const w = panelSeries("2026-01-01", "2026-11-18", { "2026-01-08": 3, "2026-01-14": 2 }, [{ day: "2026-01-02", net: 5 }]);
check("over 92 days: by week starting on the first day", w.unit === "week" && w.points[0].key === "2026-01-01" && w.points[1].key === "2026-01-08" && w.points[1].visits === 5 && w.points[0].orders === 1, w.points.slice(0, 2));
const m = panelSeries("2025-01-15", "2026-11-18", { "2025-02-03": 7 }, [{ day: "2026-11-01", net: 3 }]);
check("over 400 days: by month, Dec→Jan rolls over", m.unit === "month" && m.points[0].key === "2025-01" && m.points.some((p) => p.key === "2026-01") && m.points[1].visits === 7 && m.points[m.points.length - 1].key === "2026-11" && m.points[m.points.length - 1].orders === 1, m.points.map((p) => p.key));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
