// Revenue CSV builder — a single accountant-friendly file with sections
// for daily, monthly, product, category, and customer totals.
// All dates are local calendar days (the business's time zone), matching
// the dashboard, Analytics tab, nightly report and Concierge.

import { getOrders, parsePrice, type Order } from "./orders";
import { getProducts } from "./storage";
import { isRevenue } from "./analytics";
import { pacificDay } from "./periods";
import { brand } from "@/lib/brand";

function cell(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  return `"${String(v).replace(/"/g, '""')}"`;
}

function row(values: Array<string | number>): string {
  return values.map(cell).join(",");
}

function revenueAt(o: Order): number {
  return o.paidAt || o.createdAt;
}

export async function generateRevenueCSV(): Promise<string> {
  const [allOrders, products] = await Promise.all([getOrders(), getProducts()]);
  const orders = allOrders.filter(isRevenue).sort((a, b) => revenueAt(a) - revenueAt(b));
  const productMeta = new Map(products.map((p) => [p.id, p]));
  const lines: string[] = [];

  const grossProduct = orders.reduce((n, o) => n + (o.total - o.shippingCost), 0);
  const shipping = orders.reduce((n, o) => n + o.shippingCost, 0);
  const discounts = orders.reduce((n, o) => n + (o.discount || 0), 0);
  const total = orders.reduce((n, o) => n + o.total, 0);

  // ---- Summary ----
  lines.push(cell("REVENUE SUMMARY"));
  lines.push(row(["Generated", `${new Date().toLocaleString("en-US", { timeZone: brand.timezone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${brand.timezoneLabel}`]));
  lines.push(row(["Dates", `${brand.timezoneLabel} time; an order counts on the day it was marked paid`]));
  lines.push(row(["Basis", "Orders marked paid or shipped"]));
  lines.push(row(["Paid orders", orders.length]));
  lines.push(row(["Product revenue", grossProduct.toFixed(2)]));
  lines.push(row(["Shipping collected", shipping.toFixed(2)]));
  lines.push(row(["Promo discounts given", discounts.toFixed(2)]));
  lines.push(row(["Total collected", total.toFixed(2)]));
  lines.push(row(["Average order value", orders.length ? (total / orders.length).toFixed(2) : "0.00"]));
  lines.push("");

  // ---- Daily ----
  lines.push(cell("DAILY REVENUE"));
  lines.push(row(["Date", "Orders", "Product Revenue", "Shipping", "Discounts", "Total"]));
  const byDay = new Map<string, Order[]>();
  for (const o of orders) {
    const key = pacificDay(revenueAt(o));
    byDay.set(key, [...(byDay.get(key) || []), o]);
  }
  for (const [day, list] of Array.from(byDay.entries()).sort()) {
    lines.push(row([
      day,
      list.length,
      list.reduce((n, o) => n + (o.total - o.shippingCost), 0).toFixed(2),
      list.reduce((n, o) => n + o.shippingCost, 0).toFixed(2),
      list.reduce((n, o) => n + (o.discount || 0), 0).toFixed(2),
      list.reduce((n, o) => n + o.total, 0).toFixed(2),
    ]));
  }
  lines.push("");

  // ---- Monthly ----
  lines.push(cell("MONTHLY REVENUE"));
  lines.push(row(["Month", "Orders", "Product Revenue", "Shipping", "Discounts", "Total", "Avg Order"]));
  const byMonth = new Map<string, Order[]>();
  for (const o of orders) {
    const key = pacificDay(revenueAt(o)).slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) || []), o]);
  }
  for (const [month, list] of Array.from(byMonth.entries()).sort()) {
    const t = list.reduce((n, o) => n + o.total, 0);
    lines.push(row([
      month,
      list.length,
      list.reduce((n, o) => n + (o.total - o.shippingCost), 0).toFixed(2),
      list.reduce((n, o) => n + o.shippingCost, 0).toFixed(2),
      list.reduce((n, o) => n + (o.discount || 0), 0).toFixed(2),
      t.toFixed(2),
      (t / list.length).toFixed(2),
    ]));
  }
  lines.push("");

  // ---- By product ----
  lines.push(cell("REVENUE BY PRODUCT"));
  lines.push(row(["Product", "Category", "Units Sold", "Revenue", "Times Ordered"]));
  const byProduct = new Map<string, { name: string; category: string; units: number; revenue: number; count: number }>();
  for (const o of orders) {
    for (const item of o.items) {
      const meta = productMeta.get(item.productId);
      const e = byProduct.get(item.productId) || {
        name: item.productName,
        category: meta?.category || "Uncategorized",
        units: 0, revenue: 0, count: 0,
      };
      e.units += item.quantity;
      e.revenue += parsePrice(item.price) * item.quantity;
      e.count += 1;
      byProduct.set(item.productId, e);
    }
  }
  for (const p of Array.from(byProduct.values()).sort((a, b) => b.revenue - a.revenue)) {
    lines.push(row([p.name, p.category, p.units, p.revenue.toFixed(2), p.count]));
  }
  lines.push("");

  // ---- By category ----
  lines.push(cell("REVENUE BY CATEGORY"));
  lines.push(row(["Category", "Units Sold", "Revenue"]));
  const byCategory = new Map<string, { units: number; revenue: number }>();
  for (const p of byProduct.values()) {
    const c = byCategory.get(p.category) || { units: 0, revenue: 0 };
    c.units += p.units;
    c.revenue += p.revenue;
    byCategory.set(p.category, c);
  }
  for (const [category, v] of Array.from(byCategory.entries()).sort((a, b) => b[1].revenue - a[1].revenue)) {
    lines.push(row([category, v.units, v.revenue.toFixed(2)]));
  }
  lines.push("");

  // ---- By customer ----
  lines.push(cell("REVENUE BY CUSTOMER"));
  lines.push(row(["Customer", "Email", "Orders", "Total Spend", "Avg Order", "First Order", "Last Order"]));
  const byCustomer = new Map<string, Order[]>();
  for (const o of orders) {
    byCustomer.set(o.userId, [...(byCustomer.get(o.userId) || []), o]);
  }
  const customerRows = Array.from(byCustomer.values())
    .map((list) => {
      const spend = list.reduce((n, o) => n + o.total, 0);
      const times = list.map(revenueAt);
      return {
        name: list[0].userName,
        email: list[0].userEmail,
        orders: list.length,
        spend,
        avg: spend / list.length,
        first: pacificDay(Math.min(...times)),
        last: pacificDay(Math.max(...times)),
      };
    })
    .sort((a, b) => b.spend - a.spend);
  for (const c of customerRows) {
    lines.push(row([c.name, c.email, c.orders, c.spend.toFixed(2), c.avg.toFixed(2), c.first, c.last]));
  }
  lines.push("");

  // ---- Outstanding (unpaid) ----
  const pending = allOrders.filter((o) => o.status === "pending");
  lines.push(cell("OUTSTANDING (UNPAID) ORDERS"));
  lines.push(row(["Order ID", "Date", "Customer", "Email", "Total", "Days Waiting"]));
  for (const o of pending.sort((a, b) => a.createdAt - b.createdAt)) {
    lines.push(row([
      o.id,
      pacificDay(o.createdAt),
      o.userName,
      o.userEmail,
      o.total.toFixed(2),
      Math.floor((Date.now() - o.createdAt) / 864e5),
    ]));
  }

  return "﻿" + lines.join("\r\n");
}
