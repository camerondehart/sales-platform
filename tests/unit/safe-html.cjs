// Banner HTML keeps its formatting but nothing that can run (lib/safeHtml.ts).
// Run: node tests/unit/safe-html.cjs
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const js = ts.transpileModule(fs.readFileSync(path.join(repo, "lib/safeHtml.ts"), "utf8"), { compilerOptions: { module: 1, target: 7 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { safeBannerHtml: clean, safeHref } = mod.exports;
let pass = 0, fail = 0;
const check = (name, ok, d) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  -> " + JSON.stringify(d)}`); };
const noRun = (out) => !/<script|onerror|onload|onclick|javascript:|<iframe|<svg|<img|<object|<embed|<form|srcdoc/i.test(out);

// Ordinary banners come out exactly as typed
for (const ok of [
  "Free shipping this weekend!",
  "<strong>20% off</strong> everything — use code <b>FALL20</b>",
  'Holiday hours: <em>closed</em> Thursday<br>See <a href="/events">events</a>',
  '<span style="color:#fff;font-weight:700">New:</span> gift cards',
  '<a href="https://www.example.com/gift-cards" target="_blank" rel="noopener">Gift cards</a>',
  "Mix &amp; match 3 for $60",
  "Spend $50 &gt; get a gift",
]) check(`unchanged: ${ok.slice(0, 40)}`, clean(ok) === ok, clean(ok));

// Things that could run are removed; their text stays where it's harmless
const cases = {
  "script tag": "Sale<script>alert(1)</script> today",
  "image onerror": 'Hi <img src=x onerror="alert(1)">there',
  "svg onload": "<svg onload=alert(1)>x</svg>",
  "event attribute on an allowed tag": '<b onclick="steal()">Bold</b>',
  "javascript link": '<a href="javascript:alert(1)">tap</a>',
  "javascript link with tab": '<a href="java\tscript:alert(1)">tap</a>',
  "entity-hidden javascript link": '<a href="jav&#x61;script&colon;alert(1)">tap</a>',
  "data link": '<a href="data:text/html;base64,PHNjcmlwdD4=">tap</a>',
  "iframe": '<iframe src="https://evil.test"></iframe>Hi',
  "unclosed script": "Hi <script>alert(1)",
  "split tag": "<scr<script>ipt>alert(1)</script>",
  "quote tricks": '<a href="/x" title=">" onclick="alert(1)">x</a>',
  "style url": '<span style="background:url(javascript:alert(1))">x</span>',
  "form": '<form action="https://evil.test"><input name=p></form>',
  "uppercase": '<SCRIPT>alert(1)</SCRIPT><A HREF="JAVASCRIPT:alert(1)">x</A>',
  "comment trick": "<!--><script>alert(1)</script>-->",
};
for (const [name, html] of Object.entries(cases)) check(`blocked: ${name}`, noRun(clean(html)), clean(html));
check("text around a removed script stays", clean(cases["script tag"]) === "Sale today", clean(cases["script tag"]));
check("text of an allowed tag with a bad attribute stays", clean(cases["event attribute on an allowed tag"]) === "<b>Bold</b>", clean(cases["event attribute on an allowed tag"]));
check("a bad link keeps its words", clean(cases["javascript link"]) === "<a>tap</a>", clean(cases["javascript link"]));
check("a stray < is shown, not parsed", clean("1 < 2 and 3<4") === "1 &lt; 2 and 3&lt;4", clean("1 < 2 and 3<4"));
check("new tabs get noopener", clean('<a href="https://x.test" target="_blank">x</a>') === '<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>', clean('<a href="https://x.test" target="_blank">x</a>'));

// Banner button link
check("link: site page", safeHref("/retail") === "/retail");
check("link: https", safeHref("https://example.com") === "https://example.com");
check("link: mailto", safeHref("mailto:support@example.com") === "mailto:support@example.com");
check("link: javascript refused", safeHref(" JavaScript:alert(1)") === null);
check("link: protocol-relative refused", safeHref("//evil.test") === null);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
