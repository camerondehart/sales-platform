/**
 * The shipping numbers a bought Shippo label adds to its Activity log entry
 * (shipping.label_purchase and order.label_purchase), so staff and the
 * Concierge can see tracking and cost later. Nothing secret: no API key,
 * and the service token stays redacted by lib/audit.ts.
 */
export function labelLogFields(rate: any, transaction: any, requestedService: string) {
  const cost = parseFloat(rate?.amount);
  return {
    trackingNumber: transaction?.tracking_number || null,
    carrier: rate?.provider || null,
    service: rate?.servicelevel?.name || requestedService,
    cost: Number.isFinite(cost) ? cost : null,
    currency: rate?.currency || "USD",
    labelUrl: transaction?.label_url || null,
    transactionId: transaction?.object_id || null,
  };
}
