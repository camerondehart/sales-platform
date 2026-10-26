import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SECRET = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET environment variable is not set. Please set it to a random string of at least 32 characters."
      );
    }
    // development fallback – only for local testing
    console.warn(
      "⚠️ Warning: AUTH_SECRET not set. Using insecure development secret. Set AUTH_SECRET in your environment."
    );
    return new TextEncoder().encode("dev-secret-please-change-in-production-12345");
  }
  return new TextEncoder().encode(secret);
};

export const VISITOR_COOKIE = "gallery_visitor";
export const ADMIN_COOKIE = "gallery_admin";

export async function signVisitorToken(userId: string): Promise<string> {
  return await new SignJWT({ role: "visitor", userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET());
}

/** Staff "Log in as this member": a 1-hour member session that records who's acting. */
export const ACT_AS_MINUTES = 60;
export async function signActAsToken(userId: string, actor: string): Promise<string> {
  return await new SignJWT({ role: "visitor", userId, as: actor })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ACT_AS_MINUTES}m`)
    .sign(SECRET());
}

/** `email` is set when a staff member signed in with their emailed link. */
export async function signAdminToken(email?: string): Promise<string> {
  return await new SignJWT(email ? { role: "admin", email } : { role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(SECRET());
}

/** `as` = the staff member using "Log in as" (absent for the member's own sign-in). */
export type VisitorPayload = { role: "visitor"; userId: string; as?: string };

export async function getVisitor(): Promise<VisitorPayload | null> {
  const token = cookies().get(VISITOR_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET());
    if (payload.role === "visitor" && typeof payload.userId === "string") {
      return { role: "visitor", userId: payload.userId, ...(typeof payload.as === "string" ? { as: payload.as } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

async function adminPayload(): Promise<{ email?: string } | null> {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET());
    if (payload.role !== "admin") return null;
    if (typeof payload.email === "string") {
      // Link sign-ins end as soon as that person is taken off the staff list.
      const { findAdminCached } = await import("./adminsCache");
      if (!(await findAdminCached(payload.email))) return null;
      return { email: payload.email };
    }
    return {};
  } catch {
    return null;
  }
}

export async function isAdmin(): Promise<boolean> {
  return !!(await adminPayload());
}

/** Who is signed in to the dashboard: their email, or "admin" for the shared password. */
export async function adminActor(): Promise<string> {
  try {
    return (await adminPayload())?.email || "admin";
  } catch {
    return "admin";
  }
}

// Check visitor is signed in AND their account is still approved.
// If an admin revokes access, the user is kicked out on next request.
export async function getApprovedVisitor() {
  const v = await getVisitor();
  if (!v) return null;
  const { getUsers } = await import("./users");
  const user = (await getUsers()).find((u) => u.id === v.userId);
  if (!user || user.status !== "approved") return null;
  return user;
}
