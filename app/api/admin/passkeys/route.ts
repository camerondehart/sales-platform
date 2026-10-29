import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { adminActor, isAdmin } from "@/lib/auth";
import { audited, auditDetail } from "@/lib/audit";
import { findAdmin, getAdmins } from "@/lib/admins";
import { isEnabled } from "@/lib/flags";
import { addPasskey, CHALLENGE_COOKIE, deviceName, getPasskeys, packChallenge, publicView, relyingParty, removePasskey, unpackChallenge, userIdFor } from "@/lib/passkeys";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

// Settings → Staff sign-in → Face ID. Staff only; adding and removing are in the Activity log.
//   GET                                → passkeys (no key material), who you are, the staff list
//   POST { action: "options", email? } → start adding Face ID for this device (email: who it's for,
//                                         needed when signed in with the shared password)
//   POST { action: "verify", response } → finish adding it
//   DELETE ?id=                          → remove one

const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/admin/passkeys", maxAge: 300 };

export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { rpID } = relyingParty(req);
  const [all, staff, you, on] = await Promise.all([getPasskeys(), getAdmins(), adminActor(), isEnabled("admin_passkeys").catch(() => false)]);
  return NextResponse.json(
    { on, rpID, you, staff: staff.map((a) => ({ email: a.email, name: a.name })), passkeys: all.map(publicView).sort((a, b) => b.createdAt - a.createdAt) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isEnabled("admin_passkeys").catch(() => false))) return NextResponse.json({ error: "Face ID sign-in is switched off (Settings → Feature switches)." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string; email?: string; response?: RegistrationResponseJSON } | null;
  const { rpID, origins } = relyingParty(req);

  if (body?.action === "options") {
    // Signed in with your own link → it's yours. With the shared password → say who it's for.
    const me = await adminActor();
    const email = (me !== "admin" ? me : String(body.email || "")).trim().toLowerCase();
    const admin = email ? await findAdmin(email) : null;
    if (!admin) return NextResponse.json({ error: me === "admin" ? "Pick who this Face ID is for (they must be on the staff list)." : "You're not on the staff list." }, { status: 400 });
    const existing = (await getPasskeys()).filter((p) => p.email === admin.email && p.rpID === rpID);
    const options = await generateRegistrationOptions({
      rpName: `${brand.shortName} staff`,
      rpID,
      userName: admin.email,
      userDisplayName: admin.name,
      userID: userIdFor(admin.email),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      timeout: 60_000,
    });
    cookies().set(CHALLENGE_COOKIE, packChallenge({ c: options.challenge, k: "reg", email: admin.email }), cookieOpts);
    auditDetail({ action: "admin.passkey_start", targetId: admin.email });
    return NextResponse.json({ options, for: { email: admin.email, name: admin.name } });
  }

  if (body?.action === "verify" && body.response && typeof body.response === "object") {
    const ch = unpackChallenge(cookies().get(CHALLENGE_COOKIE)?.value, "reg");
    cookies().delete({ name: CHALLENGE_COOKIE, path: "/api/admin/passkeys" });
    if (!ch?.email) return NextResponse.json({ error: "That took too long. Press Add Face ID again." }, { status: 400 });
    const admin = await findAdmin(ch.email);
    if (!admin) return NextResponse.json({ error: "They're no longer on the staff list." }, { status: 400 });
    try {
      const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch.c, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
      if (!v.verified) throw new Error("not verified");
      const c = v.registrationInfo.credential;
      const device = deviceName(req.headers.get("user-agent") || "");
      await addPasskey({
        id: c.id, email: admin.email, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter,
        transports: c.transports, device, rpID, createdAt: Date.now(),
      });
      auditDetail({ action: "admin.passkey_added", targetId: admin.email, after: { for: admin.email, device, site: rpID } });
      return NextResponse.json({ ok: true, device, for: admin.email });
    } catch (err) {
      console.error("[passkey] add failed", err);
      return NextResponse.json({ error: "Face ID couldn't be added. Try again." }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const gone = id ? await removePasskey(id) : null;
  if (!gone) return NextResponse.json({ error: "Already removed." }, { status: 404 });
  auditDetail({ action: "admin.passkey_removed", targetId: gone.email, before: { for: gone.email, device: gone.device, site: gone.rpID } });
  return NextResponse.json({ ok: true });
}

export const POST = audited("admin.passkey", "admin", POST_handler);
export const DELETE = audited("admin.passkey_removed", "admin", DELETE_handler);
