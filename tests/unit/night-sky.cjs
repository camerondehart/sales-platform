// Night sky on the visitor's own clock (lib/nightSky.ts). Run: node tests/unit/night-sky.cjs
const path = require("path"), fs = require("fs"), { execFileSync } = require("child_process");
const repo = path.resolve(__dirname, "../..");

if (process.argv[2] === "--case") {
  // Child: TZ is already set. Print night? for each local time given.
  const ts = require(path.join(repo, "node_modules/typescript"));
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/nightSky.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  const { isNightLocal, nightHeadScript } = mod.exports;
  const out = process.argv.slice(3).map((s) => {
    const [d, t] = s.split("T"), [y, m, day] = d.split("-").map(Number), [h, mi] = t.split(":").map(Number);
    return isNightLocal(new Date(y, m - 1, day, h, mi));
  });
  // The inlined head script must decide the same way as the function itself.
  const doc = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  new Function("document", "location", nightHeadScript(null))(doc, { pathname: "/gallery" });
  const same = !!doc.documentElement.attrs["data-night"] === isNightLocal(new Date());
  const on = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  new Function("document", "location", nightHeadScript("on"))(on, { pathname: "/" });
  const staff = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  new Function("document", "location", nightHeadScript("on"))(staff, { pathname: "/admin" });
  const off = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  new Function("document", "location", nightHeadScript("off"))(off, { pathname: "/" });
  console.log(JSON.stringify({ out, same, on: on.documentElement.attrs["data-night"] === "1", off: !off.documentElement.attrs["data-night"], staff: !staff.documentElement.attrs["data-night"], staffPath: mod.exports.isStaffPath("/admin") && mod.exports.isStaffPath("/help/x") && !mod.exports.isStaffPath("/administrator-tips") && !mod.exports.isStaffPath("/gallery") }));
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const run = (tz, times) => JSON.parse(execFileSync(process.execPath, [__filename, "--case", ...times], { env: { ...process.env, TZ: tz } }).toString());

// Late November, Pacific: sunset ~4:45pm, sunrise ~7am.
let r = run("America/Los_Angeles", ["2026-11-22T12:00", "2026-11-22T16:30", "2026-11-22T18:00", "2026-11-22T23:59", "2026-11-23T03:00", "2026-11-23T06:20", "2026-11-23T07:30"]);
check("November in California: noon is day", r.out[0] === false, r);
check("November in California: 4:30pm is still day", r.out[1] === false, r);
check("November in California: 6pm, 11:59pm and 3am are night", r.out[2] && r.out[3] && r.out[4], r);
check("November in California: 6:20am is still night, 7:30am is day", r.out[5] === true && r.out[6] === false, r);
check("the head script decides like the function", r.same, r);
check("staff preview forces night on / off", r.on && r.off, r);
check("staff pages never turn to night", r.staff && r.staffPath, r);

// Midsummer, clocks forward: sunset ~8:30pm, sunrise ~5:50am.
r = run("America/Los_Angeles", ["2026-06-21T20:15", "2026-06-21T21:30", "2026-06-22T05:00", "2026-06-22T06:30"]);
check("June (clocks forward): 8:15pm is still day", r.out[0] === false, r);
check("June: 9:30pm and 5am are night", r.out[1] && r.out[2], r);
check("June: 6:30am is day", r.out[3] === false, r);

// Somewhere else: it follows the visitor's own clock, not Pacific.
r = run("America/New_York", ["2026-11-22T18:00", "2026-11-22T14:00"]);
check("New York at 6pm their time is night (3pm Pacific)", r.out[0] === true, r);
check("New York at 2pm their time is day", r.out[1] === false, r);
r = run("Europe/London", ["2026-11-22T20:00", "2026-11-22T10:00"]);
check("London at 8pm their time is night, 10am is day", r.out[0] === true && r.out[1] === false, r);
r = run("UTC", ["2026-03-01T22:00", "2026-03-01T12:00"]);
check("a clock with no daylight saving still works", r.out[0] === true && r.out[1] === false, r);

// Real dusk where the visitor is (rough area from Vercel's headers): any clock, absolute time.
{
  const ts = require(path.join(repo, "node_modules/typescript"));
  const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/nightSky.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  const { isNightAt, nightHeadScript, roughArea } = mod.exports;
  const at = (iso, lat, lon) => isNightAt(Date.parse(iso), lat, lon);
  const SEA = [47.6, -122.3], LA = [34.1, -118.2];
  check("Seattle, Nov 22 at 5:14pm: night (sunset ~4:20)", at("2026-11-23T01:14:00Z", ...SEA) === true);
  check("Seattle, Nov 22 at 4:10pm: still day", at("2026-11-23T00:10:00Z", ...SEA) === false);
  check("Los Angeles, Nov 22 at 4:50pm: still day (sunset ~4:45)", at("2026-11-23T00:50:00Z", ...LA) === false);
  check("Los Angeles, Nov 22 at 5:14pm: night", at("2026-11-23T01:14:00Z", ...LA) === true);
  check("Seattle, midnight and 6:30am in November: night", at("2026-11-23T08:00:00Z", ...SEA) && at("2026-11-23T14:30:00Z", ...SEA));
  check("Seattle, 8am in November: day", at("2026-11-23T16:00:00Z", ...SEA) === false);
  check("Seattle, June 21 at 9pm: still day; 9:45pm: night", at("2026-06-22T04:00:00Z", ...SEA) === false && at("2026-06-22T04:45:00Z", ...SEA) === true);
  check("Far north in December (polar night): night at noon", at("2026-12-21T11:00:00Z", 69.6, 18.9) === true);
  check("Far north in June (midnight sun): day at midnight", at("2026-06-21T23:00:00Z", 69.6, 18.9) === false);
  check("area is rounded to about 10 km", JSON.stringify(roughArea({ lat: 47.6062, lon: -122.3321 })) === JSON.stringify({ lat: 47.6, lon: -122.3 }) && roughArea(null) === null);
  const doc = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
  new Function("document", "location", nightHeadScript(null, { lat: 47.6, lon: -122.3 }))(doc, { pathname: "/" });
  check("the head script with an area decides like isNightAt", !!doc.documentElement.attrs["data-night"] === isNightAt(Date.now(), 47.6, -122.3));
}

// Every light surface on the customer pages keeps dark text at night (scripts/night-surfaces.cjs).
let surf = "";
try { surf = execFileSync(process.execPath, [path.join(repo, "scripts/night-surfaces.cjs"), "--check"]).toString(); } catch (e) { surf = String(e.stdout || e); }
check("night list covers every light surface (else run node scripts/night-surfaces.cjs)", /up to date/.test(surf), surf.trim());

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
