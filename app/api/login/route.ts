import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  signVisitorToken,
  signAdminToken,
  VISITOR_COOKIE,
  ADMIN_COOKIE,
} from "@/lib/auth";
import { getAdminPassword } from "@/lib/storage";
import { verifyPassword } from "@/lib/users";
import { checkRateLimit, recordFailedAttempt } from "@/lib/rateLimit";
import { auditSystem } from "@/lib/audit";
import { isEnabled } from "@/lib/flags";
import { matchesPhrase, oldPasswordStatus } from "@/lib/staffPhrase";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    role: "visitor" | "admin";
    email?: string;
    password: string;
  };

  // Get client IP from headers
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown";
  const emailForRateLimit = body.email?.toLowerCase() || "unknown";

  // Check rate limit before any processing
  const { blocked } = checkRateLimit(emailForRateLimit, ip);
  if (blocked) {
    // Still add a delay to avoid revealing rate limit status
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  // slow failed attempts slightly to discourage brute-force
  const fail = async (code: string, status = 401) => {
    await new Promise((r) => setTimeout(r, 600));
    // Record the failed attempt
    recordFailedAttempt(emailForRateLimit, ip);
    return NextResponse.json({ error: code }, { status });
  };

  if (body.role === "admin") {
    // With the daily staff password on, today's phrase signs in; the old
    // fixed password only for its first 7 days (lib/staffPhrase.ts).
    let how = "Signed in with the shared password";
    if (await isEnabled("rotating_staff_password")) {
      const old = await oldPasswordStatus();
      if (matchesPhrase(body.password || "")) {
        how = "Signed in with the daily staff password";
      } else if (old.works && body.password === (await getAdminPassword())) {
        how = "Signed in with the old fixed password (still allowed for its first 7 days)";
      } else {
        return fail("invalid");
      }
    } else {
      const expected = await getAdminPassword();
      if (body.password !== expected) {
        return fail("invalid");
      }
    }
    const token = await signAdminToken();
    cookies().set(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    await auditSystem({ action: "admin.signin", actor: "admin", actorType: "admin", source: "human", targetType: "admin", ok: true, note: how, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 200) || undefined });
    return NextResponse.json({ ok: true });
  }

  // visitor login — verify user email + password + status
  if (!body.email) return fail("missing_email");
  const user = await verifyPassword(body.email, body.password);
  if (!user) return fail("invalid");

  if (user.status === "pending") {
    return NextResponse.json({ error: "pending" }, { status: 403 });
  }
  if (user.status === "rejected") {
    return NextResponse.json({ error: "rejected" }, { status: 403 });
  }

  const token = await signVisitorToken(user.id);
  cookies().set(VISITOR_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ ok: true, name: user.name });
}
