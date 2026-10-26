import EventsClient from "./EventsClient";
import { brand } from "@/lib/brand";

export const metadata = {
  title: `Classes & Events · ${brand.name}`,
  description: "Upcoming classes, workshops, and vendor events.",
};

export const dynamic = "force-dynamic";

export default function EventsPage() {
  return <EventsClient />;
}
