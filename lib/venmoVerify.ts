import { promises as fs } from "fs";
import { splitMessage, addressOf } from "./venmoParse";

/**
 * Is this really from Venmo? Forwarded mail always fails SPF, so we rely on
 * Venmo's own DKIM signature, which Gmail's auto-forward leaves intact:
 *  - a DKIM signature that PASSES for d=venmo.com,
 *  - aligned with the From address (exactly one From, @venmo.com),
 *  - signing the From and Subject headers,
 *  - covering the whole body (no l= tag leaving room to add text),
 *  - addressed (signed To) to the business's Venmo email, VENMO_ACCOUNT_EMAIL, so a
 *    real Venmo email from someone else's account can't be passed off as ours.
 * Anything else is quarantined and never matched.
 */

export const VENMO_DOMAIN = "venmo.com";

export type Verdict = { ok: true; selector?: string; arc?: string } | { ok: false; reason: string };

type Resolver = (name: string, type: string) => Promise<string[][]>;

// Tests only (never on Vercel): a JSON file of { "<selector>._domainkey.<domain>": "v=DKIM1; k=rsa; p=…" }.
async function testResolver(): Promise<Resolver | undefined> {
  const file = process.env.DKIM_TEST_KEYS_FILE;
  if (!file || process.env.VERCEL) return undefined;
  const keys = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, string>;
  return async (name: string) => {
    const v = keys[name.toLowerCase()];
    if (!v) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return [[v]];
  };
}

export async function verifyVenmo(raw: string): Promise<Verdict> {
  const { all } = splitMessage(raw);
  const froms = all.filter(([k]) => k === "from").map(([, v]) => v);
  if (froms.length !== 1) return { ok: false, reason: `Has ${froms.length} From lines (expected one).` };
  const from = addressOf(froms[0]);
  const fromDomain = from.split("@")[1] || "";
  if (fromDomain !== VENMO_DOMAIN && !fromDomain.endsWith(`.${VENMO_DOMAIN}`)) return { ok: false, reason: `Not from Venmo (From: ${from || "none"}).` };
  const subjects = all.filter(([k]) => k === "subject").length;
  if (subjects !== 1) return { ok: false, reason: `Has ${subjects} Subject lines (expected one).` };
  const account = (process.env.VENMO_ACCOUNT_EMAIL || "").trim().toLowerCase();
  if (!account) return { ok: false, reason: "VENMO_ACCOUNT_EMAIL isn't set, so we can't tell whose Venmo this is for." };
  const tos = all.filter(([k]) => k === "to").map(([, v]) => v);
  const toList = tos.join(",").split(",").map(addressOf).filter(Boolean);
  if (tos.length !== 1 || !toList.includes(account)) return { ok: false, reason: `Sent to ${toList.join(", ") || "nobody"}, not to the Venmo account email.` };

  let result: { results?: Array<any>; arc?: any };
  try {
    const { dkimVerify } = await import("mailauth");
    result = await dkimVerify(raw, { resolver: (await testResolver()) as any });
  } catch (err) {
    return { ok: false, reason: `Couldn't check the signature (${err instanceof Error ? err.message : "error"}).` };
  }
  // An unsigned message comes back as one "none" result.
  const sigs = (result.results || []).filter((r) => r.status?.result !== "none");
  const good = sigs.find((r) => {
    const d = String(r.signingDomain || "").toLowerCase();
    const keys: string[] = (r.signingHeaders?.keys || "").toString().toLowerCase().split(/\s*:\s*/);
    return (
      r.status?.result === "pass" &&
      d === VENMO_DOMAIN &&
      !!r.status?.aligned &&
      keys.includes("from") &&
      keys.includes("subject") &&
      keys.includes("to") &&
      !r.canonBodyLengthLimited
    );
  });
  if (!good) {
    const seen = sigs.map((r) => `${r.signingDomain || "?"}: ${r.status?.result || "?"}${r.status?.comment ? ` (${r.status.comment})` : ""}`).join("; ");
    return { ok: false, reason: sigs.length ? `Venmo's signature didn't check out — ${seen}.` : "No DKIM signature (a real Venmo email always has one)." };
  }
  return { ok: true, selector: good.selector, arc: result.arc?.status?.result };
}
