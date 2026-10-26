// Order status vocabulary and helpers.
//
// Kept in its own module with no Node imports so client components can use it.
// lib/orders.ts touches `fs`, so importing these from there would drag the
// filesystem module into the browser bundle.

export type OrderStatus =
  | "inquiry"
  | "pending"
  | "paid"
  | "completed"
  // Legacy values still present in stored orders. Both mean "completed";
  // whether it shipped or was collected is already told by shippingMethod,
  // so they're merged everywhere they're shown or filtered.
  | "shipped"
  | "picked-up"
  | "cancelled";

/** The five statuses actually shown in the UI. */
export type DisplayStatus = "inquiry" | "pending" | "paid" | "completed" | "cancelled";

/** Collapse legacy shipped / picked-up into the single completed status. */
export function normalizeStatus(status: OrderStatus): DisplayStatus {
  return status === "shipped" || status === "picked-up" ? "completed" : status;
}

export function isCompleted(status: OrderStatus): boolean {
  return normalizeStatus(status) === "completed";
}
