/** "20% off" / "$5 off" for a discount code (client-safe). */
export function offerText(d: { type?: string; value?: number } | null | undefined): string | null {
  if (!d || !(Number(d.value) > 0)) return null;
  const v = Number(d.value);
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return d.type === "fixed" ? `$${n} off` : `${n}% off`;
}
