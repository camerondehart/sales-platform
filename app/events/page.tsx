import EventsClient from "./EventsClient";
import { brand } from "@/lib/brand";
import { isEnabled } from "@/lib/flags";

export const metadata = {
  title: `Classes & Events · ${brand.name}`,
  description: "Upcoming classes, workshops, and vendor events.",
};

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const stores = await isEnabled("store_locator").catch(() => false);
  return <EventsClient stores={stores} />;
}
