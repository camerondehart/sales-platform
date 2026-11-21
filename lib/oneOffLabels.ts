/**
 * One-off Shippo labels: labels staff buy for a member from
 * Members → Ship to Shippo, outside any order. Each one is kept here so it
 * shows in that member's History. Order labels stay on the
 * order itself (lib/orders.ts).
 *
 * Saving never fails the label purchase: the postage is already bought by
 * then, so an error is logged and the label is still handed back to staff.
 */

import path from "path";
import { VersionedStore } from "./versionedStore";

export type OneOffLabel = {
  id: string;
  userId: string;
  productName: string;
  quantity: number;
  weightOz: number;
  service: string;
  /** What Shippo charged, in dollars. */
  amount?: number;
  trackingNumber?: string;
  labelUrl: string;
  transactionId: string;
  /** Staff email, or "admin" for the shared password. */
  createdBy: string;
  createdAt: number;
};

const store = new VersionedStore<OneOffLabel>({
  name: "one-off-labels",
  legacyKey: "one-off-labels.json",
  localFile: path.join(process.cwd(), "data", "one-off-labels.json"),
  keep: 6,
  reconcileLegacy: false,
});

export async function labelsForMember(userId: string): Promise<OneOffLabel[]> {
  return (await store.read()).data
    .filter((l) => l.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function recordOneOffLabel(label: Omit<OneOffLabel, "id" | "createdAt">): Promise<void> {
  try {
    const at = Date.now();
    const row: OneOffLabel = {
      ...label,
      id: `lbl_${at.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      createdAt: at,
    };
    await store.mutate((rows) => ({ data: [...rows, row], result: undefined }));
  } catch (err) {
    console.error("[one-off-labels] could not record", label.transactionId, err);
  }
}
