import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  getSubscribers,
  removeSubscriberById,
  addSubscriber,
  activeSubscribers,
} from "@/lib/subscribers";
import { audited } from "@/lib/audit";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const all = await getSubscribers();
  return NextResponse.json({
    subscribers: all.sort((a, b) => b.subscribedAt - a.subscribedAt),
    activeCount: activeSubscribers(all).length,
  });
}

async function POST_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { email, name } = await req.json();
  const sub = await addSubscriber(email || "", name, "manual");
  if (!sub) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  return NextResponse.json({ ok: true, subscriber: sub });
}

async function DELETE_handler(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  await removeSubscriberById(id);
  return NextResponse.json({ ok: true });
}

// One audit-log entry per request (see lib/audit.ts).
export const POST = audited("subscriber.add", "subscriber", POST_handler);
export const DELETE = audited("subscriber.remove", "subscriber", DELETE_handler);
