import { NextResponse } from "next/server";
import { getEvents, getRegistrations, countFor } from "@/lib/events";

// Always read fresh — capacity and waitlist counts change constantly.
export const dynamic = "force-dynamic";

// Public: upcoming published events with live capacity counts.
export async function GET() {
  const [events, regs] = await Promise.all([getEvents(), getRegistrations()]);
  const now = Date.now();

  const upcoming = events
    .filter((e) => e.published && (e.endDate || e.date) >= now - 864e5)
    .sort((a, b) => a.date - b.date)
    .map((e) => {
      const registered = countFor(regs, e.id, "registered");
      const waitlisted = countFor(regs, e.id, "waitlisted");
      const spotsLeft = e.capacity === 0 ? null : Math.max(0, e.capacity - registered);
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        endDate: e.endDate || null,
        location: e.location,
        price: e.price || null,
        type: e.type,
        image: e.image || null,
        capacity: e.capacity,
        spotsLeft,
        registered,
        waitlisted,
        waitlistOpen:
          spotsLeft === 0 &&
          (e.waitlistCapacity === 0 || waitlisted < e.waitlistCapacity),
        full:
          spotsLeft === 0 &&
          e.waitlistCapacity !== 0 &&
          waitlisted >= e.waitlistCapacity,
      };
    });

  return NextResponse.json({ events: upcoming });
}
