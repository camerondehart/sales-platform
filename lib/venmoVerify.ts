import { promises as fs } from "fs";
import { splitMessage, addressOf } from "./venmoParse";
import { brand } from "./brand";

/**
 * Is this really from Venmo? Forwarded mail always fails SPF, so we rely on
 * Venmo's own DKIM signature, which Gmail's auto-forward leaves intact:
 *  - a DKIM signature that PASSES for d=venmo.com,
 *  - aligned with the From address (exactly one From, @venmo.com),
 *  - signing the From and Subject headers,
 *  - covering the whole body (no l= tag leaving room to add text),
 *  - addressed (signed To) to the business's Venmo email, VENMO_ACCOUNT_EMAIL, so a
 *    real Venmo email from someone else's account can't be passed off as ours.
 *
 * When VENMO_ACCOUNT_EMAIL is a Google Group (support@), the group rewrites
 * From to the group's own address ("'Venmo' via support") and Venmo's
 * signature no longer checks out. Then we rely on Google's ARC record instead
 * (verifyViaGoogleGroup below): a chain sealed only by google.com, whose first
 * hop says Venmo's DKIM and DMARC passed when Google received the email, and
 * whose newest signature covers From, To and Subject as they are now.
 * Anything else is quarantined and never matched.
 */

const ARC_SEALER = "google.com";

export const VENMO_DOMAIN = "venmo.com";
/** Zelle "You received money" emails come from the business's bank (brand.config payments.zelleBank). */
export const ZELLE_DOMAIN = brand.payments.zelleBank.domain;

export type PaySource = "venmo" | "zelle";
const SOURCE: Record<PaySource, { domain: string; name: string }> = {
  venmo: { domain: VENMO_DOMAIN, name: "Venmo" },
  zelle: { domain: ZELLE_DOMAIN, name: brand.payments.zelleBank.name || "your bank" },
};

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

/**
 * Same checks for a Zelle email, with the bank in place of Venmo: its
 * signature (the bank's domain or a subdomain, e.g. notify.wellsfargo.com),
 * or Google's record that it passed on arrival.
 */
export async function verifyVenmo(raw: string, source: PaySource = "venmo"): Promise<Verdict> {
  const { domain, name } = SOURCE[source];
  if (!domain) return { ok: false, reason: "No Zelle bank is set (brand.config payments.zelleBank), so we can't check who sent it." };
  const isOurs = (d: string) => isDomain(d, domain);
  const { all } = splitMessage(raw);
  const froms = all.filter(([k]) => k === "from").map(([, v]) => v);
  if (froms.length !== 1) return { ok: false, reason: `Has ${froms.length} From lines (expected one).` };
  const from = addressOf(froms[0]);
  const fromDomain = from.split("@")[1] || "";
  const account = (process.env.VENMO_ACCOUNT_EMAIL || "").trim().toLowerCase();
  const viaGroup = !!account && from === account;
  if (!viaGroup && !isOurs(fromDomain)) return { ok: false, reason: `Not from ${name} (From: ${from || "none"}).` };
  const subjects = all.filter(([k]) => k === "subject").length;
  if (subjects !== 1) return { ok: false, reason: `Has ${subjects} Subject lines (expected one).` };
  if (!account) return { ok: false, reason: "VENMO_ACCOUNT_EMAIL isn't set, so we can't tell whose Venmo this is for." };
  const tos = all.filter(([k]) => k === "to").map(([, v]) => v);
  const toList = tos.join(",").split(",").map(addressOf).filter(Boolean);
  if (tos.length !== 1 || !toList.includes(account)) return { ok: false, reason: `Sent to ${toList.join(", ") || "nobody"}, not to the Venmo account email.` };
  if (viaGroup) return verifyViaGoogleGroup(raw, source);

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
      (source === "venmo" ? d === VENMO_DOMAIN : isOurs(d)) &&
      !!r.status?.aligned &&
      keys.includes("from") &&
      keys.includes("subject") &&
      keys.includes("to") &&
      !r.canonBodyLengthLimited
    );
  });
  if (!good) {
    const seen = sigs.map((r) => `${r.signingDomain || "?"}: ${r.status?.result || "?"}${r.status?.comment ? ` (${r.status.comment})` : ""}`).join("; ");
    return { ok: false, reason: sigs.length ? `${name}'s signature didn't check out — ${seen}.` : `No DKIM signature (a real ${name} email always has one).` };
  }
  return { ok: true, selector: good.selector, arc: result.arc?.status?.result };
}

function isDomain(domain: string, base: string): boolean {
  const d = domain.toLowerCase().replace(/^@/, "");
  return d === base || d.endsWith(`.${base}`);
}

/**
 * The email came through the Google Group that VENMO_ACCOUNT_EMAIL points at
 * (From is the group's address). Trust it only when Google's ARC chain
 * vouches for it: every seal is google.com and checks out, the newest ARC
 * signature passes and covers From, To and Subject, and the first hop's
 * results (written by Google when the email arrived from Venmo) say Venmo's
 * DKIM passed and DMARC passed for venmo.com.
 */
async function verifyViaGoogleGroup(raw: string, source: PaySource): Promise<Verdict> {
  const { domain, name } = SOURCE[source];
  let data: any;
  let first: any;
  let result: any;
  try {
    const { dkimVerify, arc } = await import("mailauth");
    const resolver = (await testResolver()) as any;
    data = (await dkimVerify(raw, { resolver }) as any).arc;
    const chain: any[] = (data && data.chain) || [];
    if (!chain.length) return { ok: false, reason: `Came through the support group but has no Google forwarding record (ARC), so we can't tell it's from ${name}.` };
    // Copy before arc() tidies the newest entry in place.
    first = JSON.parse(JSON.stringify(chain[0]?.["arc-authentication-results"]?.parsed || null));
    const sealers = chain.map((e) => String(e?.["arc-seal"]?.parsed?.d?.value || "").toLowerCase());
    if (sealers.some((d) => d !== ARC_SEALER)) return { ok: false, reason: `Forwarding record sealed by ${sealers.join(", ")}, not only by Google.` };
    result = await arc(data, { resolver });
  } catch (err) {
    return { ok: false, reason: `Couldn't check Google's forwarding record (${err instanceof Error ? err.message : "error"}).` };
  }
  if (result?.status?.result !== "pass") return { ok: false, reason: `Google's forwarding record didn't check out (arc=${result?.status?.result || "?"}${result?.status?.comment ? `, ${result.status.comment}` : ""}).` };
  const signed: string[] = String(result?.signature?.signingHeaders?.keys || "").toLowerCase().split(/\s*:\s*/);
  if (!["from", "to", "subject"].every((h) => signed.includes(h))) return { ok: false, reason: "Google's newest signature doesn't cover From, To and Subject." };
  if (result?.signature?.canonBodyLengthLimited) return { ok: false, reason: "Google's newest signature covers only part of the body." };
  if (String(first?.i?.value) !== "1" || String(first?.value || "").toLowerCase() !== "mx.google.com") return { ok: false, reason: "The first hop of the forwarding record isn't Google's." };
  const theirDkim = (Array.isArray(first?.dkim) ? first.dkim : []).some((e: any) => e?.value === "pass" && isDomain(String(e?.header?.d || e?.header?.i || "").split("@").pop() || "", domain));
  const theirDmarc = first?.dmarc?.value === "pass" && isDomain(String(first?.dmarc?.header?.from || ""), domain);
  if (!theirDkim || !theirDmarc) return { ok: false, reason: `Google's record doesn't show ${name}'s signature passing when the email arrived.` };
  return { ok: true, arc: "pass" };
}
