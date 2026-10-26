// Safe storage on (a fake) Vercel Blob: the code path the e2e suite can't
// reach locally. Checks the switch-over used by products & discount codes:
//  - before any version exists, reads come from the old single file
//  - importLegacy() starts the versions from the old file (and again later,
//    carrying over edits made while the switch was off)
//  - 3 "servers" × 10 saves at once: nothing lost, no version written twice
//  - the guard still refuses an empty catalog
// Run: node tests/unit/versioned-blob.cjs
const path = require("path"), fs = require("fs"), os = require("os");
const repo = path.resolve(__dirname, "../..");
const ts = require(path.join(repo, "node_modules/typescript"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-"));
const src = fs.readFileSync(path.join(repo, "lib", "versionedStore.ts"), "utf8");
fs.writeFileSync(path.join(dir, "versionedStore.js"), ts.transpileModule(src, { compilerOptions: { module: 1, target: 7 } }).outputText);

// ---- fake @vercel/blob + fetch (in memory, with random delays so writers interleave)
const store = new Map(); // pathname -> { body, uploadedAt }
const nap = () => new Promise((r) => setTimeout(r, Math.random() * 6));
fs.mkdirSync(path.join(dir, "node_modules/@vercel/blob"), { recursive: true });
fs.writeFileSync(path.join(dir, "node_modules/@vercel/blob/index.js"), "module.exports = globalThis.__fakeBlob;");
let clock = 1;
globalThis.__fakeBlob = {
  async list({ prefix }) {
    await nap();
    const blobs = [...store.entries()].filter(([p]) => p.startsWith(prefix)).map(([p, v]) => ({ pathname: p, url: `https://fake.blob/${p}`, uploadedAt: new Date(v.uploadedAt) }));
    return { blobs };
  },
  async put(p, body, opts) {
    await nap();
    if (store.has(p) && !opts.allowOverwrite) throw new Error(`This blob already exists: ${p}`);
    store.set(p, { body, uploadedAt: clock++ });
    return { url: `https://fake.blob/${p}` };
  },
  async del(urls) {
    for (const u of [].concat(urls)) store.delete(u.replace("https://fake.blob/", ""));
  },
};
globalThis.fetch = async (url) => {
  await nap();
  const p = String(url).replace("https://fake.blob/", "").split("?")[0];
  const hit = store.get(p);
  return { ok: !!hit, status: hit ? 200 : 404, json: async () => JSON.parse(hit.body) };
};
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_x";

const { VersionedStore } = require(path.join(dir, "versionedStore.js"));
const make = () =>
  new VersionedStore({
    name: "products",
    legacyKey: "products.json",
    localFile: path.join(dir, "unused.json"),
    keep: 30,
    reconcileLegacy: false,
    guard: (before, after) => (before.length > 0 && after.length === 0 ? "Refusing to write empty products list" : null),
  });

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `  -> ${JSON.stringify(detail)}`}`);
};

(async () => {
  const legacy = [{ id: "p1", name: "Harmony" }, { id: "p2", name: "Thrive" }];
  store.set("products.json", { body: JSON.stringify(legacy), uploadedAt: clock++ });

  const a = make(), b = make(), c = make(); // three separate servers
  let snap = await a.read();
  check("before switching: reads the old products.json", snap.version === 0 && snap.data.length === 2, snap);

  const n = await a.importLegacy();
  snap = await b.read();
  check("switch on: versions start from products.json", n === 2 && snap.version === 1 && snap.data.map((p) => p.id).join() === "p1,p2", snap);

  const jobs = [];
  for (let i = 0; i < 30; i++) {
    const s = [a, b, c][i % 3];
    jobs.push(s.mutate((list) => ({ data: [...list, { id: `n${i}`, name: `New ${i}` }], result: i })));
  }
  await Promise.all(jobs);
  snap = await c.read();
  const ids = new Set(snap.data.map((p) => p.id));
  check("30 saves at once from 3 servers: all 30 kept, originals kept", snap.data.length === 32 && [...Array(30).keys()].every((i) => ids.has(`n${i}`)) && ids.has("p1"), snap.data.length);
  check("one version per save (no save overwrote another)", snap.version === 31, snap.version);
  const versions = [...store.keys()].filter((k) => k.startsWith("products/v"));
  check("old versions pruned to the last 30", versions.length <= 31, versions.length);

  // Switch off for a while: the old code path edits products.json directly.
  store.set("products.json", { body: JSON.stringify([{ id: "p1", name: "Harmony (edited while off)" }, { id: "p9", name: "Added while off" }]), uploadedAt: clock++ });
  await b.importLegacy(); // switch back on
  snap = await a.read();
  check("switch on again: edits made while off are carried over", snap.data.length === 2 && snap.data[0].name.includes("while off") && snap.data[1].id === "p9", snap.data);

  let refused = "";
  try {
    await a.mutate(() => ({ data: [], result: null }));
  } catch (e) {
    refused = e.message;
  }
  check("empty catalog still refused", /Refusing/.test(refused), refused);

  const noLegacy = new VersionedStore({ name: "discounts", legacyKey: "discounts.json", localFile: path.join(dir, "x.json"), reconcileLegacy: false });
  check("no old file: import is a no-op", (await noLegacy.importLegacy()) === 0 && (await noLegacy.read()).data.length === 0);

  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
