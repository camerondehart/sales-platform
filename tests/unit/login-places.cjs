// Where people sign in (lib/loginPlaces.ts). Run: node tests/unit/login-places.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/loginPlaces.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { placeFromHeaders, addSignIn, summarize, placeLabel } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const hdr = (o) => (n) => o[n];

const chico = placeFromHeaders(hdr({ "x-vercel-ip-latitude": "39.72851", "x-vercel-ip-longitude": "-121.83749", "x-vercel-ip-city": "Chico", "x-vercel-ip-country-region": "ca", "x-vercel-ip-country": "us" }));
check("Vercel's town headers are read and rounded", JSON.stringify(chico) === JSON.stringify({ city: "Chico", region: "CA", country: "US", lat: 39.73, lon: -121.84 }), chico);
const sp = placeFromHeaders(hdr({ "x-vercel-ip-latitude": "-23.55", "x-vercel-ip-longitude": "-46.63", "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-vercel-ip-country": "BR" }));
check("URL-encoded city names are decoded", sp && sp.city === "São Paulo", sp);
check("no location headers = nothing noted", placeFromHeaders(hdr({ "x-vercel-ip-city": "Chico" })) === null);
check("junk coordinates = nothing noted", placeFromHeaders(hdr({ "x-vercel-ip-latitude": "abc", "x-vercel-ip-longitude": "1" })) === null && placeFromHeaders(hdr({ "x-vercel-ip-latitude": "95", "x-vercel-ip-longitude": "1" })) === null);
const odd = placeFromHeaders(hdr({ "x-vercel-ip-latitude": "1", "x-vercel-ip-longitude": "1", "x-vercel-ip-city": "<b>x</b>" }));
check("markup is stripped from the town", odd && !/[<>]/.test(odd.city), odd);
check("a missing city still maps", placeFromHeaders(hdr({ "x-vercel-ip-latitude": "1", "x-vercel-ip-longitude": "1" })).city === "Unknown town");

let rows = [];
rows = addSignIn(rows, "2026-11-20", "member", chico, "2025-10-01");
rows = addSignIn(rows, "2026-11-20", "member", chico, "2025-10-01");
rows = addSignIn(rows, "2026-11-20", "staff", chico, "2025-10-01");
rows = addSignIn(rows, "2026-11-21", "member", sp, "2025-10-01");
check("same day, town and kind add up in one row", rows.length === 3 && rows[0].count === 2, rows);
check("rows hold no email, address or account", rows.every((r) => !("email" in r) && !("ip" in r) && !("userId" in r)));
rows = addSignIn([{ day: "2025-01-01", kind: "member", city: "Old", lat: 0, lon: 0, count: 5 }, ...rows], "2026-11-21", "store", chico, "2025-10-18");
check("rows past the keep window are dropped", !rows.some((r) => r.city === "Old"), rows);

const all = summarize(rows, "2026-11-01");
check("totals per town, biggest first", all.total === 4 && all.places[0].city === "Chico" && all.places[0].count === 3, all);
check("Everyone leaves staff out; each town splits by kind", JSON.stringify(all.places[0].byKind) === JSON.stringify({ member: 2, staff: 0, store: 1 }), all.places[0].byKind);
check("kind filter", summarize(rows, "2026-11-01", "staff").total === 1);
check("period filter", summarize(rows, "2026-11-21").total === 2);
check("labels: US towns show the state, others the country", placeLabel(chico) === "Chico, CA" && placeLabel(sp) === "São Paulo, BR", [placeLabel(chico), placeLabel(sp)]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
