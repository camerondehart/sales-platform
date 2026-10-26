// Product descriptions: long paragraphs are split into sentences for display.
// This checks no text is ever lost (e.g. ".15g" used to drop the text before it).
// Run: node tests/unit/description-split.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const src = fs.readFileSync(path.join(repo, "app/components/FormattedDescription.tsx"), "utf8");
const js = ts.transpileModule(src.slice(src.indexOf("export function splitSentences")), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const split = mod.exports.splitSentences;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const same = (a, b) => a.join("").replace(/\s+/g, "") === b.replace(/\s+/g, "");
const cases = [
  "Our tincture is made with organic glycerin (alcohol content 40-50%).  One bulb-squeeze full dropper contains about .15g(150mg) of Conscious Compounds. Embrace the gentle rhythm.",
  "Take 2.5 ml, approx. 3 times a day. Store below 25.5°C. Shake well!",
  "Dr. Smith recommends it. Contains 0.5g per serving... Enjoy? Yes. “Quoted sentence.” (Bracketed one.) Done",
  "no punctuation at all just a long line of words that keeps going",
  "Ends with a decimal like 1.5",
];
for (const c of cases) check(`nothing lost: ${c.slice(0, 40)}…`, same(split(c), c), split(c));
check("“.15g” stays inside its sentence", split(cases[0]).some((s) => s.includes("about .15g(150mg) of Conscious Compounds.")), split(cases[0]));
check("“2.5 ml” and “approx. 3” aren't split", split(cases[1])[0] === "Take 2.5 ml, approx. 3 times a day.", split(cases[1]));
check("real sentences still split", split(cases[0]).length === 3, split(cases[0]));
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
