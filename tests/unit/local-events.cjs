// Events note for locals (lib/localEvents.ts). Run: node tests/unit/local-events.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/localEvents.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
// lib/localEvents.ts reads its starting town from brand.config.ts: hand it the same file, transpiled.
const brandJs = ts.transpileModule(fs.readFileSync(path.join(repo, "brand.config.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const brandMod = { exports: {} };
new Function("module", "exports", "require", brandJs)(brandMod, brandMod.exports, require);
const req = (m) => (/brand\.config$/.test(m) ? brandMod.exports : require(m));
new Function("module", "exports", "require", js)(mod, mod.exports, req);
const { milesBetween, geoFromHeaders, nearCenter, nextUpcomingEvent, CENTER, pickNoteEvent, noteSeen, shortPlace, cleanMiles, DEFAULT_NOTE_SETTINGS } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const hdr = (o) => (n) => o[n];

// The example brand's town is Springfield, IL (brand.config.ts eventsArea).
const stl = { lat: 38.627, lon: -90.1994 }, chi = { lat: 41.8781, lon: -87.6298 }, indy = { lat: 39.7684, lon: -86.1581 }, peoria = { lat: 40.6936, lon: -89.589 };
check("St. Louis is about 85 miles from Springfield", Math.abs(milesBetween(CENTER, stl) - 85) < 3, milesBetween(CENTER, stl));
check("Springfield, Peoria and St. Louis are near", nearCenter(CENTER) && nearCenter(peoria) && nearCenter(stl));
check("Chicago and Indianapolis are past 100 miles", !nearCenter(chi) && !nearCenter(indy), [milesBetween(CENTER, chi), milesBetween(CENTER, indy)]);
check("no location = not near", !nearCenter(null));
check("Vercel's location headers are read", JSON.stringify(geoFromHeaders(hdr({ "x-vercel-ip-latitude": "39.73", "x-vercel-ip-longitude": "-121.84" }))) === JSON.stringify({ lat: 39.73, lon: -121.84 }));
check("missing, blank or junk headers give no location", geoFromHeaders(hdr({})) === null && geoFromHeaders(hdr({ "x-vercel-ip-latitude": "39.7" })) === null && geoFromHeaders(hdr({ "x-vercel-ip-latitude": "abc", "x-vercel-ip-longitude": "-121" })) === null && geoFromHeaders(hdr({ "x-vercel-ip-latitude": "200", "x-vercel-ip-longitude": "-121" })) === null);
const now = Date.parse("2026-11-14T18:00:00Z"), D = 86400000;
const evs = [
  { id: "past", title: "Past", date: now - D, published: true },
  { id: "draft", title: "Draft", date: now + D, published: false },
  { id: "later", title: "Later", date: now + 9 * D, published: true },
  { id: "soon", title: "Soon", date: now + 3 * D, published: true },
];
check("the soonest published upcoming event is picked", (nextUpcomingEvent(evs, now) || {}).id === "soon");
check("nothing coming up = no event", nextUpcomingEvent(evs.slice(0, 2), now) === null);

// ---- settings and per-event control
const S = DEFAULT_NOTE_SETTINGS;
check("the default area comes from brand.config.ts (Springfield, Illinois, 100 miles)", S.area.place === "Springfield, IL" && S.area.miles === 100 && /Illinois/.test(S.area.found));
check("near the town: the soonest event in the popup", (pickNoteEvent(evs, S, CENTER, now) || {}).event?.id === "soon" && pickNoteEvent(evs, S, CENTER, now).more === 1);
check("far away: nothing", pickNoteEvent(evs, S, chi, now) === null && pickNoteEvent(evs, S, null, now) === null);
const off = evs.map((e) => (e.id === "soon" ? { ...e, notePopup: false } : e));
check("an event left out of the popup is skipped", (pickNoteEvent(off, S, CENTER, now) || {}).event?.id === "later" && pickNoteEvent(off, S, CENTER, now).more === 0);
const own = evs.map((e) => (e.id === "soon" ? { ...e, noteArea: { place: "Indianapolis, IN", lat: indy.lat, lon: indy.lon, miles: 30 } } : e));
check("an event with its own area reaches its own town, not the main one", (pickNoteEvent(own, S, CENTER, now) || {}).event?.id === "later" && (pickNoteEvent(own, S, indy, now) || {}).area?.place === "Indianapolis, IN");
const wider = { ...S, area: { ...S.area, miles: 200 } };
check("a wider main area reaches Chicago", (pickNoteEvent(evs, wider, chi, now) || {}).event?.id === "soon");
check("seen once = seen, until Show it again", noteSeen(now, undefined) && noteSeen(now, now - D) && !noteSeen(now, now + D) && !noteSeen(undefined, undefined));
check("short town name for the card", shortPlace("Springfield, IL") === "Springfield" && shortPlace("Los Angeles") === "Los Angeles");
check("miles must be 1 to 500", cleanMiles("100") === 100 && cleanMiles(0) === null && cleanMiles(501) === null && cleanMiles("x") === null);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
