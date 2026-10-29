// The daily staff password (lib/staffPhrase.ts). Run: node tests/unit/staff-phrase.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const load = (file, req) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, file), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, req);
  return mod.exports;
};
const periods = load("lib/periods.ts", (m) => (m === "@/lib/brand" ? { brand: { timezone: "America/Los_Angeles" } } : require(m)));
let rows = [];
class FakeStore {
  async read() { return { data: rows, version: 1 }; }
  async mutate(fn) { const r = fn(rows); if (r.data) rows = r.data; return r.result; }
}
process.env.AUTH_SECRET = "unit-test-secret-at-least-32-characters";
const sp = load("lib/staffPhrase.ts", (m) => (m === "./periods" ? periods : m === "./versionedStore" ? { VersionedStore: FakeStore } : m === "./flags" ? { currentEnv: () => "production" } : require(m)));

let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const at = (iso) => Date.parse(iso);

const p = sp.phraseFor("2026-10-29");
check("looks like word-word-NN", /^[a-z]+-[a-z]+-\d\d$/.test(p), p);
check("same day, same phrase", sp.phraseFor("2026-10-29") === p);
const week = Array.from({ length: 30 }, (_, i) => sp.phraseFor(periods.addDays("2026-10-01", i)));
check("changes every day", new Set(week).size === 30, week);
check("two different words", week.every((w) => w.split("-")[0] !== w.split("-")[1]), week);
// 9 am UTC = 2 am PDT on Oct 29: the nightly email's phrase is the new day's.
check("nightly email time is already the new Pacific day", periods.pacificDay(at("2026-10-29T09:00:00Z")) === "2026-10-29");
const early = sp.acceptablePhrases(at("2026-10-29T18:59:00Z")); // 11:59 am PDT
check("before noon: today's and yesterday's", early.length === 2 && early[0] === p && early[1] === sp.phraseFor("2026-10-28"), early);
const late = sp.acceptablePhrases(at("2026-10-29T19:00:00Z")); // noon PDT
check("from noon: today's only", late.length === 1 && late[0] === p, late);
check("winter time too (noon PST = 20:00Z)", sp.acceptablePhrases(at("2026-12-05T19:59:00Z")).length === 2 && sp.acceptablePhrases(at("2026-12-05T20:00:00Z")).length === 1);
const noon = at("2026-10-29T19:00:00Z");
check("forgiving: capitals and spaces", sp.matchesPhrase(p.toUpperCase().replace(/-/g, " "), noon));
check("yesterday's refused from noon", !sp.matchesPhrase(sp.phraseFor("2026-10-28"), noon));
check("tomorrow's refused", !sp.matchesPhrase(sp.phraseFor("2026-10-30"), noon));
check("empty refused", !sp.matchesPhrase("", noon) && !sp.matchesPhrase("--", noon));
const other = (process.env.AUTH_SECRET = "a-different-secret-at-least-32-characters", sp.phraseFor("2026-10-29"));
check("depends on AUTH_SECRET", other !== p, other);

(async () => {
  rows = [];
  const t0 = Date.now();
  const a = await sp.oldPasswordStatus();
  check("first run records the start; old password works", a.works && rows.length === 1 && rows[0].id === "production" && rows[0].startedAt >= t0, { a, rows });
  const b = await sp.oldPasswordStatus();
  check("start isn't moved by later runs", rows.length === 1 && b.until === a.until);
  check("old password works until day 7", (await sp.oldPasswordStatus(rows[0].startedAt + 7 * 86400000 - 1)).works);
  check("old password stops after 7 days", !(await sp.oldPasswordStatus(rows[0].startedAt + 7 * 86400000)).works);
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
