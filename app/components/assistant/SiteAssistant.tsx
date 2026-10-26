"use client";

import { usePathname } from "next/navigation";
import AssistantWidget from "./AssistantWidget";

// The customer-facing assistant, on every page except the staff areas —
// the admin dashboard mounts its own staff version.
export default function SiteAssistant() {
  const path = usePathname() || "";
  if (path.startsWith("/admin") || path.startsWith("/help")) return null;
  return <AssistantWidget key="site" mode="site" />;
}
