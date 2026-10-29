// Store map styles (lib/mapStyle.ts): both themes must be valid MapLibre
// styles, keep the required OpenStreetMap credit, and take their colours
// from the site's tokens. Run: node tests/unit/map-style.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const { validateStyleMin } = require(path.join(repo, "node_modules/@maplibre/maplibre-gl-style-spec"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/mapStyle.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { buildMapStyle, mix, ATTRIBUTION } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d).slice(0, 400)}`); };

const light = { bg: "#f9f9f8", surface: "#f9f9f8", ink: "#61676d", muted: "#81858b", rule: "#abaeb2", accent: "#85ba45", water: "#0fc7a3", dark: false };
const dark = { bg: "#15190f", surface: "#1c2216", ink: "#e4e8dc", muted: "#a3ab9d", rule: "#3b4535", accent: "#85ba45", water: "#0fc7a3", dark: true };
for (const [name, k] of [["light", light], ["dark", dark]]) {
  const st = buildMapStyle(k);
  const errs = validateStyleMin(st);
  check(`${name} style is a valid MapLibre style`, errs.length === 0, errs.map((e) => e.message));
  check(`${name}: background is the site background`, st.layers[0].paint["background-color"] === k.bg, st.layers[0]);
  check(`${name}: OpenStreetMap credit kept`, /OpenStreetMap contributors/.test(st.sources.openmaptiles.attribution));
  const water = st.layers.find((l) => l.id === "water").paint["fill-color"];
  check(`${name}: water is a tint between background and brand mint`, water !== k.bg && water !== k.water, water);
  check(`${name}: labels use the site ink`, st.layers.find((l) => l.id === "place-city").paint["text-color"] === k.ink);
}
check("light and dark differ", JSON.stringify(buildMapStyle(light)) !== JSON.stringify(buildMapStyle(dark)));
check("mix: halfway", mix("#000000", "#ffffff", 0.5) === "#808080", mix("#000000", "#ffffff", 0.5));
check("mix: short hex", mix("#fff", "#000", 0) === "#ffffff");
check("mix: unparseable falls back to the first colour", mix("var(--x)", "#000", 0.5) === "var(--x)");
check("attribution names OpenStreetMap", ATTRIBUTION.includes("OpenStreetMap contributors"));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
