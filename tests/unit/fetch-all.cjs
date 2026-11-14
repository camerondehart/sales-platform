// Order files are never silently skipped (lib/fetchAll.ts).
// Run: node tests/unit/fetch-all.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/fetchAll.ts"), "utf8"), { compilerOptions: { module: 1, target: 7, esModuleInterop: true } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { fetchAllJson } = mod.exports;

let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const files = (n) => Array.from({ length: n }, (_, i) => ({ url: `u${i}` }));
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

(async () => {
  // 1. Everything loads, in order, and never more than `concurrency` at once.
  let live = 0, peak = 0;
  const all = await fetchAllJson(files(100), {
    concurrency: 8, backoffMs: 0,
    fetchImpl: async (u) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 1)); live--; return okRes({ id: u }); },
  });
  check("100 files all load", all.length === 100 && all.every((o, i) => o && o.id === `u${i}`));
  check("at most 8 at a time", peak <= 8 && peak > 1, peak);

  // 2. The store throttles the second half once (what broke the nightly report): a retry gets them all.
  const seen = new Map();
  const throttled = await fetchAllJson(files(60), {
    backoffMs: 0,
    fetchImpl: async (u) => {
      const n = (seen.get(u) || 0) + 1; seen.set(u, n);
      if (Number(u.slice(1)) >= 30 && n === 1) return { ok: false, status: 429, json: async () => ({}) };
      return okRes({ id: u });
    },
  });
  check("throttled files are retried, none missing", throttled.filter(Boolean).length === 60, throttled.filter(Boolean).length);

  // 3. A thrown network error is retried too.
  let tries = 0;
  const flaky = await fetchAllJson(files(1), { backoffMs: 0, fetchImpl: async () => { if (++tries < 3) throw new Error("socket hang up"); return okRes({ id: "a" }); } });
  check("network error retried", flaky[0] && flaky[0].id === "a" && tries === 3, tries);

  // 4. Still failing after every try: an error, never a partial list.
  let err = null, calls = 0;
  try {
    await fetchAllJson(files(10), { backoffMs: 0, attempts: 3, what: "order", fetchImpl: async (u) => { calls++; return u === "u7" ? { ok: false, status: 503, json: async () => ({}) } : okRes({ id: u }); } });
  } catch (e) { err = e; }
  check("persistent failure throws", !!err && /1 of 10 order files/.test(err.message) && /503/.test(err.message), err && err.message);
  check("gave it 3 tries", calls === 9 + 3, calls);

  // 5. A file deleted since the listing (404) is simply absent, no retry, no error.
  let c404 = 0;
  const gone = await fetchAllJson(files(3), { backoffMs: 0, fetchImpl: async (u) => (u === "u1" ? (c404++, { ok: false, status: 404, json: async () => ({}) }) : okRes({ id: u })) });
  check("404 is skipped quietly", gone[0] && gone[1] === null && gone[2] && c404 === 1, gone);

  // 6. A file that never parses is skipped (one bad file can't block every order), after retrying.
  let bad = 0;
  const junk = await quiet(() => fetchAllJson(files(2), { backoffMs: 0, fetchImpl: async (u) => (u === "u0" ? { ok: true, status: 200, json: async () => { bad++; throw new SyntaxError("bad"); } } : okRes({ id: u })) }));
  check("unreadable file skipped after retries", junk[0] === null && junk[1] && bad === 4, { junk, bad });

  // 7. The cache-busting url is what gets requested.
  let asked = "";
  await fetchAllJson(files(1), { url: (u) => u + "?x=1", fetchImpl: async (u) => { asked = u; return okRes({}); } });
  check("url option applied", asked === "u0?x=1", asked);

  // 8. No files: empty list.
  check("empty list", (await fetchAllJson([], {})).length === 0);

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
