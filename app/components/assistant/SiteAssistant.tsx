"use client";

import { usePathname } from "next/navigation";
import AssistantWidget from "./AssistantWidget";

// The customer-facing assistant, on every page except the staff areas —
// the admin dashboard mounts its own staff version, the store portal its store version.
export default function SiteAssistant() {
  const path = usePathname() || "";
  // The store portal mounts its own store version (when signed in).
  if (path.startsWith("/admin") || path.startsWith("/help") || path.startsWith("/store-portal")) return null;
  return <AssistantWidget key="site" mode="site" />;
}
